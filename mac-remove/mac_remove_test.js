import { sleep } from 'k6';
import exec from 'k6/execution';
import { Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { createFilterSession, executeMacRemove, getBulkJobs } from './lib/macRemove.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

// One SID per line (lines starting with # are ignored). Path is relative to this script. MAC_REMOVE changes real
// customer data, so the list is deliberately empty by default: without SIDs the script stops at start-up and sends nothing.
const SIDS_FILE = __ENV.SIDS_FILE || '../data/mac_remove_sids.txt';
const sids = new SharedArray('mac_remove_sids', function () {
  return open(SIDS_FILE)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
});
if (sids.length === 0) {
  throw new Error(`No SIDs found in ${SIDS_FILE} -- add one SID per line (lines starting with # are ignored)`);
}

const ENTITY_EID = __ENV.ENTITY_EID || 'EID26000069';
const ENTITY_FILTER_TYPE = __ENV.ENTITY_FILTER_TYPE || 'TOTAL_CUSTOMER';
const BILLING_TYPE = __ENV.BILLING_TYPE || 'PREPAID';
const ISP = __ENV.ISP || 'true';
const SIDS_PER_JOB = Number(__ENV.SIDS_PER_JOB) || 10;

// Phase timing. The phases are separated by wall-clock barriers so that filter-session and execute never overlap:
//   phase 1 (create sessions)  : from the start until CREATE_WINDOW seconds have passed
//   phase 2 (execute sessions) : from CREATE_WINDOW until the VU has executed everything it created
//   phase 3 (watch the jobs)   : optional, starts EXECUTE_WINDOW seconds after phase 2 begins
const CREATE_WINDOW_SECONDS = Number(__ENV.CREATE_WINDOW) || 30;
const EXECUTE_WINDOW_SECONDS = Number(__ENV.EXECUTE_WINDOW) || 60;
// Only the exact string 'true' turns a flag on (k6 env values are strings, so 'false' must not count as on).
const MONITOR_JOBS = __ENV.MONITOR_JOBS === 'true';
const LOGIN_PER_VU = __ENV.LOGIN_PER_ITERATION === 'true';
const POLL_INTERVAL_SECONDS = Number(__ENV.POLL_INTERVAL) || 2;
const POLL_TIMEOUT_SECONDS = Number(__ENV.POLL_TIMEOUT) || 120;
const JOBS_PAGE_SIZE = Number(__ENV.JOBS_PAGE_SIZE) || 50;
const SLEEP_BETWEEN_CALLS = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 0;

// Custom metrics. `*_phase_seconds` is how long one VU actually spent in that phase (its requests / that = its rate).
const createPhaseSeconds = new Trend('mac_remove_create_phase_seconds');
const executePhaseSeconds = new Trend('mac_remove_execute_phase_seconds');
const sessionsCreated = new Counter('mac_remove_sessions_created');
const sessionsNotCreated = new Counter('mac_remove_sessions_not_created');
const jobsStarted = new Counter('mac_remove_jobs_started');
const tasksCompleted = new Counter('mac_remove_tasks_completed');
const tasksFailed = new Counter('mac_remove_tasks_failed');
const jobsTimedOut = new Counter('mac_remove_jobs_timed_out');
const jobDrainSeconds = new Trend('mac_remove_job_drain_seconds');

const { logRequest, getLogs } = createRequestLogger('mac_remove_test.js');

// ALL_SIDS_PER_VU=true: every VU sends ONE request containing the WHOLE SID list, so VUS=5 means 5 simultaneous jobs
// that all cover the same SIDs. Only the exact string 'true' turns it on.
// Default (off): the list is split into jobs of SIDS_PER_JOB, every SID is used exactly once, each VU takes every
// ACTIVE_VUS-th job so the VUs share the work without overlapping, and VUS is capped at the number of jobs.
const ALL_SIDS_PER_VU = __ENV.ALL_SIDS_PER_VU === 'true';
const totalJobs = ALL_SIDS_PER_VU ? Number(__ENV.VUS) || 1 : Math.ceil(sids.length / SIDS_PER_JOB);
const ACTIVE_VUS = Math.min(Number(__ENV.VUS) || 1, totalJobs);

const maxDurationSeconds =
  CREATE_WINDOW_SECONDS + EXECUTE_WINDOW_SECONDS + (MONITOR_JOBS ? POLL_TIMEOUT_SECONDS : 0) + 120;

export const options = {
  scenarios: {
    default: {
      executor: 'per-vu-iterations',
      vus: ACTIVE_VUS,
      iterations: 1,
      maxDuration: __ENV.DURATION || `${maxDurationSeconds}s`,
    },
  },
  // The name-tagged sub-metrics make k6's own summary show each API on its own, without login or job polling mixed in.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:MAC_REMOVE_FILTER_SESSION}': ['p(95)<3000'],
    'http_req_duration{name:MAC_REMOVE_EXECUTE}': ['p(95)<3000'],
    'http_reqs{name:MAC_REMOVE_FILTER_SESSION}': ['count>=0'],
    'http_reqs{name:MAC_REMOVE_EXECUTE}': ['count>=0'],
  },
};

function loginAndLog(user) {
  const loginRes = login(user.username, user.password);
  logRequest({
    apiName: 'LOGIN',
    requestMethod: 'POST',
    url: loginRes.url,
    requestPayload: { username: user.username, password: user.password },
    statusCode: loginRes.status,
    errorMessage: loginRes.error || '',
    responseTime: loginRes.timings?.duration,
    responseBody: loginRes.body,
  });
  checkStatus200(loginRes);
  return loginRes;
}

// Mode A (default): log in once per distinct user here, before the timed load, and share the tokens with every VU.
// If any login fails the whole run aborts, so a bad account can't silently fire every call without a token.
// Also fixes the clock times for the phase barriers, so every VU waits for the same moment.
// Mode B (LOGIN_PER_ITERATION=true): no shared login; each VU logs in for itself at the start.
export function setup() {
  const tokens = [];
  if (!LOGIN_PER_VU) {
    const seen = {};
    for (const user of users) {
      if (seen[user.username]) continue;
      seen[user.username] = true;

      const loginRes = loginAndLog(user);
      if (loginRes.status !== 200) {
        throw new Error(`setup login failed for ${user.username} (status ${loginRes.status}): ${loginRes.body}`);
      }
      tokens.push(buildAuthHeaders(loginRes));
    }
  }

  const startedAt = Date.now();
  const phase2At = startedAt + CREATE_WINDOW_SECONDS * 1000;
  const phase3At = phase2At + EXECUTE_WINDOW_SECONDS * 1000;
  return { tokens, phase2At, phase3At };
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/mac_remove-report.html': htmlReport(data),
    'reports/mac_remove-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/mac_remove-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

function sleepUntil(timestampMs) {
  const waitMs = timestampMs - Date.now();
  if (waitMs > 0) sleep(waitMs / 1000);
}

function isFinished(job) {
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'ERROR'].includes(job.jobStatus)) return true;
  return job.totalTasks > 0 && job.completedTasks + job.failedTasks >= job.totalTasks;
}

export default function (data) {
  // Unique 0..ACTIVE_VUS-1 number for this VU (each VU runs exactly one iteration).
  const vuIndex = exec.scenario.iterationInTest;

  let authHeaders;
  if (LOGIN_PER_VU) {
    const user = users[Math.floor(Math.random() * users.length)];
    authHeaders = buildAuthHeaders(loginAndLog(user));
  } else {
    authHeaders = data.tokens[vuIndex % data.tokens.length];
  }

  // ---------- Phase 1: create every session this VU is responsible for, and keep the sessionIds ----------
  const mySessions = [];
  const createStartedAt = Date.now();

  for (let jobIndex = vuIndex; jobIndex < totalJobs; jobIndex += ACTIVE_VUS) {
    if (Date.now() >= data.phase2At) {
      // Out of time: the window ended before this VU finished. Count what was skipped instead of overlapping into phase 2.
      sessionsNotCreated.add(Math.ceil((totalJobs - jobIndex) / ACTIVE_VUS));
      break;
    }

    const chunk = ALL_SIDS_PER_VU ? sids.slice(0) : sids.slice(jobIndex * SIDS_PER_JOB, jobIndex * SIDS_PER_JOB + SIDS_PER_JOB);
    const { response, payload } = createFilterSession(authHeaders, {
      entityEid: ENTITY_EID,
      isp: ISP,
      billingType: BILLING_TYPE,
      entityFilterType: ENTITY_FILTER_TYPE,
      sids: chunk,
    });
    logRequest({
      apiName: 'MAC_REMOVE_FILTER_SESSION',
      requestMethod: 'POST',
      url: response.url,
      requestPayload: payload,
      statusCode: response.status,
      errorMessage: response.error || '',
      responseTime: response.timings?.duration,
      responseBody: response.body,
    });

    if (checkStatus200(response)) {
      try {
        const sessionId = response.json('sessionId');
        if (sessionId) {
          mySessions.push(sessionId);
          sessionsCreated.add(1);
        }
      } catch {
        // no usable sessionId in the response; the failed call is already logged above
      }
    }
    if (SLEEP_BETWEEN_CALLS > 0) sleep(SLEEP_BETWEEN_CALLS);
  }
  createPhaseSeconds.add((Date.now() - createStartedAt) / 1000);

  // ---------- Barrier: nobody executes until every VU has had its full creation window ----------
  sleepUntil(data.phase2At);

  // ---------- Phase 2: execute only the sessions this VU created ----------
  const myJobs = [];
  const executeStartedAt = Date.now();

  for (const sessionId of mySessions) {
    const { response, payload } = executeMacRemove(authHeaders, sessionId);
    logRequest({
      apiName: 'MAC_REMOVE_EXECUTE',
      requestMethod: 'POST',
      url: response.url,
      requestPayload: payload,
      statusCode: response.status,
      errorMessage: response.error || '',
      responseTime: response.timings?.duration,
      responseBody: response.body,
    });

    if (checkStatus200(response)) {
      try {
        const bulkJobId = response.json('bulkJobId');
        if (bulkJobId) {
          myJobs.push(bulkJobId);
          jobsStarted.add(1);
        }
      } catch {
        // no usable bulkJobId in the response; the failed call is already logged above
      }
    }
    if (SLEEP_BETWEEN_CALLS > 0) sleep(SLEEP_BETWEEN_CALLS);
  }
  executePhaseSeconds.add((Date.now() - executeStartedAt) / 1000);

  if (!MONITOR_JOBS || myJobs.length === 0) return;

  // ---------- Phase 3 (optional): watch this VU's jobs until they finish ----------
  sleepUntil(data.phase3At);

  const pending = {};
  for (const jobId of myJobs) pending[jobId] = true;
  const deadline = Date.now() + POLL_TIMEOUT_SECONDS * 1000;

  while (Object.keys(pending).length > 0 && Date.now() < deadline) {
    const jobsRes = getBulkJobs(authHeaders, JOBS_PAGE_SIZE);
    logRequest({
      apiName: 'MAC_REMOVE_JOB_STATUS',
      requestMethod: 'GET',
      url: jobsRes.url,
      statusCode: jobsRes.status,
      errorMessage: jobsRes.error || '',
      responseTime: jobsRes.timings?.duration,
      responseBody: jobsRes.body,
    });
    checkStatus200(jobsRes);

    let jobs = [];
    try {
      const list = jobsRes.json('data');
      jobs = Array.isArray(list) ? list : [];
    } catch {
      jobs = [];
    }

    for (const job of jobs) {
      if (pending[job.jobId] && isFinished(job)) {
        delete pending[job.jobId];
        tasksCompleted.add(job.completedTasks);
        tasksFailed.add(job.failedTasks);
        jobDrainSeconds.add((Date.now() - executeStartedAt) / 1000);
      }
    }

    if (Object.keys(pending).length > 0) sleep(POLL_INTERVAL_SECONDS);
  }

  jobsTimedOut.add(Object.keys(pending).length);
}
