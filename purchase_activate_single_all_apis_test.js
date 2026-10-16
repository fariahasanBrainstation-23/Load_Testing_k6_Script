import { sleep } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { htmlReport } from './lib/vendor/k6-reporter.bundle.js';
import { textSummary } from './lib/vendor/k6-summary.js';
import { defaultOptions } from './config.js';
import { login, buildAuthHeaders } from './lib/auth.js';
import { checkStatus200 } from './lib/checks.js';
import { createRequestLogger } from './lib/requestLogger.js';
import {
  preloadPurchase,
  customerSummary,
  purchaseAll,
  eligiblePromotions,
  buildRequiredAmountPayload,
  buildCreatePayload,
  requiredAmount,
  createPurchase,
  customerBalance,
  entityBalance,
  dueAmount,
  createDetails,
} from './lib/purchaseActivateSingle.js';

// WARNING: real purchase/billing calls, same as purchase_activate_single_test.js.
//
// Difference from purchase_activate_single_test.js: that script is fail-fast -- it stops an entry's flow the
// moment PURCHASE_REQUIRED_AMOUNT or PURCHASE_CREATE doesn't return 200, which matches what a real user hits
// (the UI blocks the next step too), so its API Summary counts show the real per-API hit rate under load.
// This script instead calls every API for every entry regardless of earlier failures, so each one gets hit
// close to entries.length times -- useful for measuring each individual endpoint's own response time/throughput
// under full concurrency, but NOT a realistic user flow: PURCHASE_CREATE_DETAILS, for example, gets called with
// "UNKNOWN" when PURCHASE_CREATE never produced a referenceId, which a real client could never do, and is
// expected to fail. Treat this script's error rate as noise, not a capacity signal; use the fail-fast script for
// that.
const users = new SharedArray('users', function () {
  return JSON.parse(open('./data/users.json'));
});

// One entry per line: sid,serviceCode,entityCode (entityCode optional -- leave it blank, e.g. "SID...,SV...,"
// to skip the entity-balance check for that SID). Blank lines and lines starting with # are ignored.
const ENTRIES_FILE = __ENV.ENTRIES_FILE || './data/purchase_activate_single.txt';
const entries = new SharedArray('purchase_activate_entries', function () {
  return open(ENTRIES_FILE)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [sid, serviceCode, entityCode] = line.split(',').map((s) => s.trim());
      return { sid, serviceCode, entityCode: entityCode || null };
    });
});
if (entries.length === 0) {
  throw new Error(`No entries found in ${ENTRIES_FILE} -- add one "sid,serviceCode,entityCode" line per customer`);
}

const BILLING_START_DATE = __ENV.BILLING_START_DATE || new Date().toISOString().slice(0, 10);

const { logRequest, getLogs } = createRequestLogger('purchase_activate_single_all_apis_test.js');

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

// Each entry in ENTRIES_FILE runs its full 11-call sequence exactly once, spread across VUS concurrent VUs.
export const options = {
  scenarios: {
    default: {
      executor: 'shared-iterations',
      vus: Math.min(Number(__ENV.VUS) || 1, entries.length),
      iterations: entries.length,
      maxDuration: __ENV.DURATION || '30m',
    },
  },
  thresholds: defaultOptions.thresholds,
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
    'reports/purchase_activate_single_all_apis-report.html': htmlReport(data),
    'reports/purchase_activate_single_all_apis-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/purchase_activate_single_all_apis-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

// Times one full 11-call sequence per entry (always runs to the end here, unlike the fail-fast script).
const purchaseActivateFlowMs = new Trend('purchase_activate_flow_ms', true);

function log(apiName, method, res, payload) {
  logRequest({
    apiName,
    requestMethod: method,
    url: res.url,
    requestPayload: payload ?? '',
    statusCode: res.status,
    errorMessage: res.error || '',
    responseTime: res.timings?.duration,
    responseBody: res.body,
  });
  return checkStatus200(res);
}

export default function (data) {
  const iterationIndex = exec.scenario.iterationInTest;
  const entry = entries[iterationIndex];
  const { sid, serviceCode, entityCode } = entry;
  const flowStart = Date.now();

  let authHeaders;
  if (LOGIN_PER_ITERATION) {
    const user = users[Math.floor(Math.random() * users.length)];
    authHeaders = buildAuthHeaders(loginAndLog(user));
  } else {
    authHeaders = data.tokens[(__VU - 1) % data.tokens.length];
  }

  log('PURCHASE_PRELOAD', 'GET', preloadPurchase(authHeaders, sid));
  log('CUSTOMER_SUMMARY', 'GET', customerSummary(authHeaders, sid));
  log('PURCHASE_ALL_BEFORE', 'GET', purchaseAll(authHeaders, sid));
  log('ELIGIBLE_PROMOTIONS', 'GET', eligiblePromotions(authHeaders, sid));

  // No early return below -- every entry runs every call, regardless of what came before.
  const requiredAmountPayload = buildRequiredAmountPayload({ serviceCode, billingStartDate: BILLING_START_DATE });
  log('PURCHASE_REQUIRED_AMOUNT', 'POST', requiredAmount(authHeaders, sid, requiredAmountPayload), requiredAmountPayload);

  const createPayload = buildCreatePayload({ serviceCode, billingStartDate: BILLING_START_DATE, sid, iterationIndex });
  const createRes = createPurchase(authHeaders, sid, createPayload);
  log('PURCHASE_CREATE', 'POST', createRes, createPayload);

  let referenceId;
  try {
    referenceId = createRes.json('referenceId');
  } catch {
    referenceId = null;
  }

  log('CUSTOMER_BALANCE', 'GET', customerBalance(authHeaders, sid));
  if (entityCode) log('ENTITY_BALANCE', 'GET', entityBalance(authHeaders, entityCode));
  log('PURCHASE_DUE_AMOUNT', 'GET', dueAmount(authHeaders, sid));
  log('PURCHASE_ALL_AFTER', 'GET', purchaseAll(authHeaders, sid));
  // referenceId is "UNKNOWN" when PURCHASE_CREATE failed -- this call is expected to fail too, it's here only
  // so the API still gets hit for every entry (see the file-level note above).
  log('PURCHASE_CREATE_DETAILS', 'GET', createDetails(authHeaders, referenceId || 'UNKNOWN'));

  purchaseActivateFlowMs.add(Date.now() - flowStart);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (default 0).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 0;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
