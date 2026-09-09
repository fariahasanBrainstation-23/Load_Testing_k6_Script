import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { defaultOptions } from './config.js';
import { login, buildAuthHeaders } from './lib/auth.js';
import { uploadFile, triggerBulkUpload } from './lib/bulkUpload.js';
import { checkStatus200 } from './lib/checks.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./data/users.json'));
});

const fileBinary = open('./excel-files/customer_updateBulk.xlsx', 'b');
const FILE_NAME = 'customer_updateBulk.xlsx';

// UPDATES = number of full bulk-update operations (login + upload + trigger) to run.
export const options = __ENV.UPDATES
  ? { vus: 1, iterations: Number(__ENV.UPDATES), thresholds: defaultOptions.thresholds }
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
