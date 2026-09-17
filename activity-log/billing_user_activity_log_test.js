import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { defaultOptions } from '../config.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { getActionCodes, getSystemUserActivityLog } from './lib/activityLog.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

const { logRequest, getLogs } = createRequestLogger('billing_user_activity_log_test.js');

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU full lookup flows independently.
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

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/billing_user_activity_log-report.html': htmlReport(data),
    'reports/billing_user_activity_log-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/billing_user_activity_log-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function () {
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

  const actionCodesRes = getActionCodes(authHeaders);
  logRequest({
    apiName: 'ACTIVITY_LOG_ACTION_CODES',
    requestMethod: 'GET',
    url: actionCodesRes.url,
    statusCode: actionCodesRes.status,
    errorMessage: actionCodesRes.error || '',
    responseTime: actionCodesRes.timings?.duration,
    responseBody: actionCodesRes.body,
  });
  checkStatus200(actionCodesRes);

  const pageSize = Number(__ENV.PAGE_SIZE) || 10;

  // Page loads unfiltered first (matches real UI behavior captured in HAR).
  const unfilteredRes = getSystemUserActivityLog(authHeaders, { pageNumber: 0, pageSize });
  logRequest({
    apiName: 'ACTIVITY_LOG_SYSTEM_USER',
    requestMethod: 'GET',
    url: unfilteredRes.url,
    statusCode: unfilteredRes.status,
    errorMessage: unfilteredRes.error || '',
    responseTime: unfilteredRes.timings?.duration,
    responseBody: unfilteredRes.body,
  });
  checkStatus200(unfilteredRes);

  const actionCode = __ENV.ACTION_CODE || undefined;
  const status = __ENV.STATUS || undefined;
  const username = __ENV.FILTER_USERNAME || undefined;

  // Only fires the filtered call if at least one filter was actually passed.
  if (actionCode || status || username) {
    const filteredRes = getSystemUserActivityLog(authHeaders, { pageNumber: 0, pageSize, actionCode, status, username });
    logRequest({
      apiName: 'ACTIVITY_LOG_SYSTEM_USER_FILTERED',
      requestMethod: 'GET',
      url: filteredRes.url,
      statusCode: filteredRes.status,
      errorMessage: filteredRes.error || '',
      responseTime: filteredRes.timings?.duration,
      responseBody: filteredRes.body,
    });
    checkStatus200(filteredRes);
  }

  sleep(1);
}
