import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { sendBulkNotification } from './lib/sendNotification.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

// One SID per line (lines starting with # are ignored). Path is relative to this script.
// WARNING: every request sends a real SMS to every SID in it.
const SIDS_FILE = __ENV.SIDS_FILE || '../data/send_notification_sids.txt';
const sids = new SharedArray('send_notification_sids', function () {
  return open(SIDS_FILE)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
});
if (sids.length === 0) {
  throw new Error(`No SIDs found in ${SIDS_FILE} -- add one per line (lines starting with # are ignored)`);
}

// The server rejects a send if its title matches an existing one ("Title already exists"). A run with more than
// one job (SIDS_PER_REQUEST splitting the list) would otherwise send several requests with the identical title
// and the 2nd+ would collide with the 1st -- so every job gets its own suffixed title, always, even if TITLE is
// overridden.
const TITLE_BASE = __ENV.TITLE || `Load Test ${new Date().toISOString()}`;
const TEMPLATE_ID = Number(__ENV.TEMPLATE_ID) || 44;
const SENDING_AUDIENCE = __ENV.SENDING_AUDIENCE || 'CUSTOMER';
const SEND_SUB_AUDIENCE = __ENV.SEND_SUB_AUDIENCE || 'ALL';
const SIDS_PER_REQUEST = Number(__ENV.SIDS_PER_REQUEST) || 10;

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

// The SID list is split into requests of SIDS_PER_REQUEST, and every SID is used exactly once (no cycling --
// each real SID only ever gets one SMS in a run). VUS controls how many requests run at the same time and is
// capped at the number of jobs.
const totalJobs = Math.ceil(sids.length / SIDS_PER_REQUEST);
export const options = {
  scenarios: {
    default: {
      executor: 'shared-iterations',
      vus: Math.min(Number(__ENV.VUS) || 1, totalJobs),
      iterations: totalJobs,
      maxDuration: __ENV.DURATION || '30m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
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

const { logRequest, getLogs } = createRequestLogger('send_notification_test.js');

// Mode A (default): log in once per distinct user here, before the timed load, and share the tokens with every VU.
// If any login fails the whole run aborts, so a bad account can't silently send every notification with no token.
// Skipped entirely in Mode B (LOGIN_PER_ITERATION=true), where each iteration logs in itself.
export function setup() {
  if (LOGIN_PER_ITERATION) return { tokens: [] };

  const seen = {};
  const tokens = [];
  for (const user of users) {
    if (seen[user.username]) continue;
    seen[user.username] = true;

    const loginRes = loginAndLog(user);
    if (loginRes.status !== 200) {
      throw new Error(`setup login failed for ${user.username} (status ${loginRes.status}): ${loginRes.body}`);
    }
    tokens.push(buildAuthHeaders(loginRes));
  }
  return { tokens };
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/send_notification-report.html': htmlReport(data),
    'reports/send_notification-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/send_notification-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function (data) {
  const jobIndex = exec.scenario.iterationInTest;
  const chunk = sids.slice(jobIndex * SIDS_PER_REQUEST, jobIndex * SIDS_PER_REQUEST + SIDS_PER_REQUEST);

  let authHeaders;
  if (LOGIN_PER_ITERATION) {
    const user = users[Math.floor(Math.random() * users.length)];
    authHeaders = buildAuthHeaders(loginAndLog(user));
  } else {
    authHeaders = data.tokens[(__VU - 1) % data.tokens.length];
  }

  const { response, payload } = sendBulkNotification(authHeaders, {
    title: `${TITLE_BASE} #${jobIndex}`,
    templateId: TEMPLATE_ID,
    sendingAudience: SENDING_AUDIENCE,
    sendSubAudience: SEND_SUB_AUDIENCE,
    sids: chunk,
  });
  logRequest({
    apiName: 'BULK_SEND_NOTIFICATION',
    requestMethod: 'POST',
    url: response.url,
    requestPayload: payload,
    statusCode: response.status,
    errorMessage: response.error || '',
    responseTime: response.timings?.duration,
    responseBody: response.body,
  });
  checkStatus200(response);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (use for throughput tests).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 0;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
