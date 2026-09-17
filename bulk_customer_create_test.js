import { htmlReport } from './lib/vendor/k6-reporter.bundle.js';
import { textSummary } from './lib/vendor/k6-summary.js';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { defaultOptions } from './config.js';
import { login, buildAuthHeaders } from './lib/auth.js';
import { uploadFile, triggerBulkUpload } from './lib/bulkUpload.js';
import { checkStatus200 } from './lib/checks.js';
import { createRequestLogger } from './lib/requestLogger.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./data/users.json'));
});

// Single shared file: every VU uploads the same file.
const file = { binary: open('./excel-files/Customer V3.0 create.xlsx', 'b'), name: 'customer_createBulk_vu1.xlsx' };

const { logRequest } = createRequestLogger('bulk_customer_create_test.js');

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU full create flows independently.
// e.g. VUS=5, ITERATIONS_PER_VU=2 -> 5 VUs x 2 = 10 full create flows total.
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
    'reports/bulk_customer_create-report.html': htmlReport(data),
    'reports/summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
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

  const uploadRes = uploadFile(authHeaders, file.binary, file.name);
  logRequest({
    apiName: 'FILE_UPLOAD',
    requestMethod: 'POST',
    url: uploadRes.url,
    requestPayload: `multipart file: ${file.name}`,
    statusCode: uploadRes.status,
    errorMessage: uploadRes.error || '',
    responseTime: uploadRes.timings?.duration,
    responseBody: uploadRes.body,
  });
  checkStatus200(uploadRes);

  let filePath;
  try {
    filePath = uploadRes.json('path');
  } catch {
    filePath = null;
  }

  if (!filePath) {
    sleep(1);
    return;
  }

  const bulkRes = triggerBulkUpload(authHeaders, filePath, 'CUSTOMER_CREATE');
  logRequest({
    apiName: 'BULK_UPLOAD_TRIGGER',
    requestMethod: 'POST',
    url: bulkRes.url,
    requestPayload: { file: filePath, code: 'CUSTOMER_CREATE', instance: true },
    statusCode: bulkRes.status,
    errorMessage: bulkRes.error || '',
    responseTime: bulkRes.timings?.duration,
    responseBody: bulkRes.body,
  });
  checkStatus200(bulkRes);

  sleep(1);
}
