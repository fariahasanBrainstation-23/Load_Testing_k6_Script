import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { uploadFile, triggerBulkUpload } from '../lib/bulkUpload.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { defaultOptions } from '../config.js';
import { buildProfileOptions } from '../lib/profiles.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

// Generic bulk-upload test -- works for ANY feature code listed by GET /bulk-upload/feature
// (CUSTOMER_CREATE, PURCHASE_EXTEND, PROMO_CODE_CREATE, BANK, ... all 29+ of them), because every one of
// them uses the exact same two-step mechanism: upload an xlsx, then trigger /bulk-upload with that code.
// CODE and FILE_PATH are required -- there is deliberately no default, so a run can't silently upload the
// wrong template under the wrong code.
const CODE = __ENV.CODE;
if (!CODE) {
  throw new Error(
    'CODE is required, e.g. -e CODE=PURCHASE_EXTEND -e FILE_PATH=../excel-files/purchase_extendBulk.xlsx\n' +
      'Run GET /myrace-master-billing/api/v1/billing/bulk-upload/feature (logged in) to see every valid code.'
  );
}

const FILE_PATH = __ENV.FILE_PATH;
if (!FILE_PATH) {
  throw new Error('FILE_PATH is required -- path to the filled xlsx template for this CODE, e.g. -e FILE_PATH=../excel-files/your_file.xlsx');
}

const fileBinary = open(FILE_PATH, 'b');
const FILE_NAME = FILE_PATH.split(/[\\/]/).pop();

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

// PROFILE=smoke/ramp/soak/spike switches to a fixed-duration run that repeats the same upload+trigger over and
// over (see lib/profiles.js). Leave PROFILE unset for the default: every upload is identical work (same CODE,
// same file each time), so there's no list to index -- just VUS x ITERATIONS_PER_VU independent runs per VU,
// matching the ITERATIONS_PER_VU convention used by bulk_purchase_create_test.js and friends.
const PROFILE = __ENV.PROFILE || null;
const options = PROFILE
  ? buildProfileOptions({
      listLength: 1, // unused by the profile branches themselves, only the (skipped) no-PROFILE branch needs it
      thresholds: { http_req_duration: ['p(95)<3000'], http_req_failed: ['rate<0.01'] },
    }).options
  : __ENV.ITERATIONS_PER_VU
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
export { options };

const { logRequest, getLogs } = createRequestLogger('bulk_upload_test.js');

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
// If any login fails the whole run aborts, so a bad account (e.g. an expired password) can't silently run every
// upload with no valid token. Skipped entirely in Mode B (LOGIN_PER_ITERATION=true).
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
    'reports/bulk_upload-report.html': htmlReport(data),
    'reports/bulk_upload-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/bulk_upload-log.json': JSON.stringify(getLogs(), null, 2),
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

  const uploadRes = uploadFile(authHeaders, fileBinary, FILE_NAME);
  logRequest({
    apiName: 'BULK_UPLOAD_FILE',
    requestMethod: 'POST',
    url: uploadRes.url,
    requestPayload: `multipart file: ${FILE_NAME}`,
    statusCode: uploadRes.status,
    errorMessage: uploadRes.error || '',
    responseTime: uploadRes.timings?.duration,
    responseBody: uploadRes.body,
  });
  if (!checkStatus200(uploadRes)) {
    sleep(1);
    return;
  }

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

  const triggerRes = triggerBulkUpload(authHeaders, filePath, CODE);
  logRequest({
    apiName: `BULK_UPLOAD_TRIGGER_${CODE}`,
    requestMethod: 'POST',
    url: triggerRes.url,
    requestPayload: { file: filePath, code: CODE, instance: true },
    statusCode: triggerRes.status,
    errorMessage: triggerRes.error || '',
    responseTime: triggerRes.timings?.duration,
    responseBody: triggerRes.body,
  });
  checkStatus200(triggerRes);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (use for throughput tests).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 0;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
