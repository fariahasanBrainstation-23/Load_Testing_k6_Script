import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { defaultOptions } from './config.js';
import { login, buildAuthHeaders } from './lib/auth.js';
import { uploadFile, triggerBulkUpload } from './lib/bulkUpload.js';
import { checkStatus200 } from './lib/checks.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./data/users.json'));
});

const fileBinary = open('./excel-files/customer_update_010000.xlsx', 'b');
const FILE_NAME = 'customer_updateBulk.xlsx';

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU full update flows independently.
// e.g. VUS=5, ITERATIONS_PER_VU=2 -> 5 VUs x 2 = 10 full update flows total.
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

export default function () {
  const user = users[Math.floor(Math.random() * users.length)];

  const loginRes = login(user.username, user.password);
  checkStatus200(loginRes);
  const authHeaders = buildAuthHeaders(loginRes);

  const uploadRes = uploadFile(authHeaders, fileBinary, FILE_NAME);
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

  const bulkRes = triggerBulkUpload(authHeaders, filePath, 'CUSTOMER_UPDATE');
  checkStatus200(bulkRes);

  sleep(1);
}
