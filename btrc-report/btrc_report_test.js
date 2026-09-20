import http from 'k6/http';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { defaultOptions } from '../config.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { buildBtrcReportRequests } from './lib/btrcReport.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

const { logRequest, getLogs } = createRequestLogger('btrc_report_test.js');

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU report loads independently.
export const options = __ENV.ITERATIONS_PER_VU
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
  : defaultOptions;

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
// If any login fails the whole run aborts, so a bad account can't silently fire every report call without a token.
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
    'reports/btrc_report-report.html': htmlReport(data),
    'reports/btrc_report-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/btrc_report-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function (data) {
  let authHeaders;
  if (LOGIN_PER_ITERATION) {
    const user = users[Math.floor(Math.random() * users.length)];
    authHeaders = buildAuthHeaders(loginAndLog(user));
  } else {
    authHeaders = data.tokens[(__VU - 1) % data.tokens.length];
  }

  const billingStatuses = (__ENV.BILLING_STATUSES || 'ACTIVE')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const reqs = buildBtrcReportRequests(authHeaders, {
    billingStatuses,
    pageNumber: Number(__ENV.PAGE_NUMBER) || 0,
    pageSize: Number(__ENV.PAGE_SIZE) || 10,
  });

  // The UI fires the list and summary calls at the same instant, so do the same.
  const [listRes, summaryRes] = http.batch([reqs.list, reqs.summary]);

  logRequest({
    apiName: 'BTRC_REPORT',
    requestMethod: 'GET',
    url: listRes.url,
    requestPayload: reqs.payload,
    statusCode: listRes.status,
    errorMessage: listRes.error || '',
    responseTime: listRes.timings?.duration,
    responseBody: listRes.body,
  });
  checkStatus200(listRes);

  logRequest({
    apiName: 'BTRC_REPORT_SUMMARY',
    requestMethod: 'GET',
    url: summaryRes.url,
    requestPayload: reqs.payload,
    statusCode: summaryRes.status,
    errorMessage: summaryRes.error || '',
    responseTime: summaryRes.timings?.duration,
    responseBody: summaryRes.body,
  });
  checkStatus200(summaryRes);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (use for throughput tests).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 1;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
