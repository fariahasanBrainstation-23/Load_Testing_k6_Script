import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { defaultOptions } from '../config.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { getPurchaseThirdParty } from './lib/serviceMonitor.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

const { logRequest, getLogs } = createRequestLogger('service_monitor_test.js');

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU service monitor lookups independently.
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
      throw new Error(`setup login failed for ${user.username} (status ${loginRes.status})`);
    }
    tokens.push(buildAuthHeaders(loginRes));
  }
  return { tokens };
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/service_monitor-report.html': htmlReport(data),
    'reports/service_monitor-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/service_monitor-log.json': JSON.stringify(getLogs(), null, 2),
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

  const filters = {
    partyType: __ENV.PARTY_TYPE || 'CUSTOMER',
    status: __ENV.STATUS || 'ACTIVE',
    detailsStatus: __ENV.DETAILS_STATUS || 'FAILED',
    pageNumber: 0,
    pageSize: Number(__ENV.PAGE_SIZE) || 10,
  };

  const res = getPurchaseThirdParty(authHeaders, filters);
  logRequest({
    apiName: 'SERVICE_MONITOR',
    requestMethod: 'GET',
    url: res.url,
    statusCode: res.status,
    errorMessage: res.error || '',
    responseTime: res.timings?.duration,
    responseBody: res.body,
  });
  checkStatus200(res);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (use for throughput tests).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 1;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
