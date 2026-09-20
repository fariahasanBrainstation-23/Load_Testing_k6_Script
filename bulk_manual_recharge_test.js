import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { htmlReport } from './lib/vendor/k6-reporter.bundle.js';
import { textSummary } from './lib/vendor/k6-summary.js';
import { BASE_URL } from './config.js';
import { login, buildAuthHeaders } from './lib/auth.js';
import { manualRecharge } from './lib/manualRecharge.js';
import { checkStatus200 } from './lib/checks.js';
import { createRequestLogger } from './lib/requestLogger.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./data/users.json'));
});

const sids = new SharedArray('sids', function () {
  return JSON.parse(open('./data/sids.json'));
});

const { logRequest, getLogs } = createRequestLogger('bulk_manual_recharge_test.js');

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

// Processes each SID in data/sids.json exactly once, spread across VUS concurrent VUs.
export const options = {
  scenarios: {
    default: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS) || 1,
      iterations: sids.length,
      maxDuration: __ENV.DURATION || '50m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000'],
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

// Mode A (default): log in once per distinct user here, before the timed load, and share the tokens with every VU.
// If any login fails the whole run aborts, so a bad account can't silently fire every recharge without a token.
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
    'reports/bulk_manual_recharge-report.html': htmlReport(data),
    'reports/bulk_manual_recharge-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/bulk_manual_recharge-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function (data) {
  const sid = sids[exec.scenario.iterationInTest];

  let authHeaders;
  if (LOGIN_PER_ITERATION) {
    const user = users[Math.floor(Math.random() * users.length)];
    authHeaders = buildAuthHeaders(loginAndLog(user));
  } else {
    authHeaders = data.tokens[(__VU - 1) % data.tokens.length];
  }

  const { response: rechargeRes, payload: rechargePayload } = manualRecharge(authHeaders, sid);
  logRequest({
    apiName: 'MANUAL_RECHARGE',
    requestMethod: 'POST',
    url: `${BASE_URL}/myrace-master-billing/api/v1/billing/transaction/manual-recharge`,
    requestPayload: rechargePayload,
    statusCode: rechargeRes.status,
    errorMessage: rechargeRes.error || '',
    responseTime: rechargeRes.timings?.duration,
    responseBody: rechargeRes.body,
  });
  checkStatus200(rechargeRes);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (default stays 1s as before).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 1;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
