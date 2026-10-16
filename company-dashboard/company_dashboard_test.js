import http from 'k6/http';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { defaultOptions } from '../config.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { buildCompanyDashboardRequests, COMPANY_DASHBOARD_CALL_COUNT } from './lib/companyDashboard.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

// One company code per line (lines starting with # are ignored). Path is relative to this script.
const COMPANY_CODES_FILE = __ENV.COMPANY_CODES_FILE || '../data/company_codes.txt';
const NO_COMPANY_FILTER = __ENV.NO_COMPANY_FILTER === 'true';
const companyCodes = new SharedArray('company_codes', function () {
  if (NO_COMPANY_FILTER) return [null];
  return open(COMPANY_CODES_FILE)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
});
if (companyCodes.length === 0) {
  throw new Error(`No company codes found in ${COMPANY_CODES_FILE} -- add one per line (lines starting with # are ignored)`);
}

const FROM_MONTH = __ENV.FROM_MONTH || '2025-10';
const TO_MONTH = __ENV.TO_MONTH || '2026-09';

const { logRequest, getLogs } = createRequestLogger('company_dashboard_test.js');

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU dashboard loads independently.
// Without ITERATIONS_PER_VU it runs VUS constant VUs for DURATION (default 30s).
// batchPerHost: k6 only sends 6 requests at a time per host inside one http.batch unless raised, and all 14
// dashboard calls are meant to go out together.
export const options = {
  ...(__ENV.ITERATIONS_PER_VU
    ? {
        scenarios: {
          default: {
            executor: 'per-vu-iterations',
            vus: Number(__ENV.VUS) || 1,
            iterations: Number(__ENV.ITERATIONS_PER_VU),
            maxDuration: __ENV.DURATION || '5m',
          },
        },
        thresholds: defaultOptions.thresholds,
      }
    : defaultOptions),
  batch: COMPANY_DASHBOARD_CALL_COUNT,
  batchPerHost: COMPANY_DASHBOARD_CALL_COUNT,
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
    'reports/company_dashboard-report.html': htmlReport(data),
    'reports/company_dashboard-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/company_dashboard-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

const dashboardLoadMs = new Trend('dashboard_load_ms', true);

function fireAndLog(group) {
  const start = Date.now();
  const responses = http.batch(group.requests);
  dashboardLoadMs.add(Date.now() - start);
  responses.forEach((res, i) => {
    logRequest({
      ...group.meta[i],
      url: res.url,
      statusCode: res.status,
      errorMessage: res.error || '',
      responseTime: res.timings?.duration,
      responseBody: res.body,
    });
    checkStatus200(res);
  });
}

export default function (data) {
  // Each VU keeps its own company for the whole run: VU 1 -> line 1 of the list, VU 2 -> line 2, and so on
  // (wrapping around if there are more VUs than company codes).
  const companyCode = companyCodes[(__VU - 1) % companyCodes.length];

  let authHeaders;
  if (LOGIN_PER_ITERATION) {
    const user = users[Math.floor(Math.random() * users.length)];
    authHeaders = buildAuthHeaders(loginAndLog(user));
  } else {
    authHeaders = data.tokens[(__VU - 1) % data.tokens.length];
  }

  const calls = buildCompanyDashboardRequests(authHeaders, {
    companyCode,
    fromMonth: FROM_MONTH,
    toMonth: TO_MONTH,
  });

  // All 14 dashboard calls go out together in one batch.
  fireAndLog(calls);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (use for throughput tests).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 0;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
