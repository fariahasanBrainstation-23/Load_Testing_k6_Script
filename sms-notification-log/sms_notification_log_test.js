import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { defaultOptions } from '../config.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { getSmsNotificationLog } from './lib/smsNotificationLog.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

const { logRequest, getLogs } = createRequestLogger('sms_notification_log_test.js');

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
    'reports/sms_notification_log-report.html': htmlReport(data),
    'reports/sms_notification_log-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/sms_notification_log-log.json': JSON.stringify(getLogs(), null, 2),
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

  const pageSize = Number(__ENV.PAGE_SIZE) || 10;
  const defaultStatus = __ENV.DELIVERY_STATUS || 'FAILED';

  // Page loads with deliveryStatus=FAILED by default (matches real UI behavior captured in HAR).
  const defaultRes = getSmsNotificationLog(authHeaders, { pageNumber: 0, pageSize, deliveryStatus: defaultStatus });
  logRequest({
    apiName: 'SMS_NOTIFICATION_LOG_FILTERED',
    requestMethod: 'GET',
    url: defaultRes.url,
    statusCode: defaultRes.status,
    errorMessage: defaultRes.error || '',
    responseTime: defaultRes.timings?.duration,
    responseBody: defaultRes.body,
  });
  checkStatus200(defaultRes);

  // Only fires the unfiltered call if the user explicitly clears the default FAILED filter.
  if (__ENV.LOAD_ALL) {
    const unfilteredRes = getSmsNotificationLog(authHeaders, { pageNumber: 0, pageSize });
    logRequest({
      apiName: 'SMS_NOTIFICATION_LOG',
      requestMethod: 'GET',
      url: unfilteredRes.url,
      statusCode: unfilteredRes.status,
      errorMessage: unfilteredRes.error || '',
      responseTime: unfilteredRes.timings?.duration,
      responseBody: unfilteredRes.body,
    });
    checkStatus200(unfilteredRes);
  }

  sleep(1);
}
