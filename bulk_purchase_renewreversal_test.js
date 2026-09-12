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

const fileBinary = open('./Excel-files/purchase_renewReversalBulk.xlsx', 'b');
const FILE_NAME = 'purchase_renewReversalBulk.xlsx';

const { logRequest, getLogs } = createRequestLogger('bulk_purchase_renewreversal_test.js');

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU full renew-reversal flows independently.
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
    stdout: '',
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/bulk_purchase_renewreversal-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function () {
  const user = users[Math.floor(Math.random() * users.length)];

  const loginRes = login(user.username, user.password);
  logRequest({
    apiName: 'LOGIN',
    requestMethod: 'POST',
    url: loginRes.url,
    statusCode: loginRes.status,
    errorMessage: loginRes.error || '',
    responseTime: loginRes.timings?.duration,
    responseBody: loginRes.body,
  });
  checkStatus200(loginRes);
  const authHeaders = buildAuthHeaders(loginRes);

  const uploadRes = uploadFile(authHeaders, fileBinary, FILE_NAME);
  logRequest({
    apiName: 'FILE_UPLOAD',
    requestMethod: 'POST',
    url: uploadRes.url,
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

  const bulkRes = triggerBulkUpload(authHeaders, filePath, 'PURCHASE_RENEW_REVERSAL');
  logRequest({
    apiName: 'BULK_UPLOAD_TRIGGER',
    requestMethod: 'POST',
    url: bulkRes.url,
    statusCode: bulkRes.status,
    errorMessage: bulkRes.error || '',
    responseTime: bulkRes.timings?.duration,
    responseBody: bulkRes.body,
  });
  checkStatus200(bulkRes);

  sleep(1);
}
