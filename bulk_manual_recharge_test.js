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

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/bulk_manual_recharge-report.html': htmlReport(data),
    'reports/bulk_manual_recharge-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/bulk_manual_recharge-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function () {
  const sid = sids[exec.scenario.iterationInTest];
  const user = users[Math.floor(Math.random() * users.length)];

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
  const authHeaders = buildAuthHeaders(loginRes);

  const { response: rechargeRes, payload: rechargePayload } = manualRecharge(authHeaders, sid);
  logRequest({
    apiName: `MANUAL_RECHARGE (${sid})`,
    requestMethod: 'POST',
    url: `${BASE_URL}/myrace-master-billing/api/v1/billing/transaction/manual-recharge`,
    requestPayload: rechargePayload,
    statusCode: rechargeRes.status,
    errorMessage: rechargeRes.error || '',
    responseTime: rechargeRes.timings?.duration,
    responseBody: rechargeRes.body,
  });
  checkStatus200(rechargeRes);

  sleep(1);
}
