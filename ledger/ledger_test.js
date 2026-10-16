import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { defaultOptions } from '../config.js';
import { login, buildAuthHeaders } from '../lib/auth.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import { LEDGER_TYPES, ledgerApiName, buildLedgerRequest } from './lib/ledger.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../data/users.json'));
});

// ---------- The mix: which ledger types the VUs are split across ----------
// LEDGER_MIX="CUSTOMER_LEDGER:40,ENTITY_INVOICE_LEDGER:30,BROKER_PERSON_LEDGER:30" (numbers are shares of VUS, so
// counts or percentages both work). Required: there is deliberately no default split.
const validTypes = Object.keys(LEDGER_TYPES).join(', ');
if (!__ENV.LEDGER_MIX) {
  throw new Error(
    `LEDGER_MIX is required, e.g. -e LEDGER_MIX=CUSTOMER_LEDGER:40,ENTITY_INVOICE_LEDGER:30,BROKER_PERSON_LEDGER:30\n` +
      `Valid ledger types: ${validTypes}`
  );
}

const mix = __ENV.LEDGER_MIX.split(',').map((part) => {
  const [type, weightText] = part.trim().split(':');
  const weight = Number(weightText);
  if (!LEDGER_TYPES[type]) throw new Error(`Unknown ledger type "${type}" in LEDGER_MIX. Valid types: ${validTypes}`);
  if (!(weight > 0)) throw new Error(`LEDGER_MIX weight for ${type} must be a number above 0 (got "${weightText}")`);
  return { type, weight };
});
if (new Set(mix.map((m) => m.type)).size !== mix.length) {
  throw new Error('LEDGER_MIX lists the same ledger type more than once');
}

// Share the VUs out by weight so the total is exactly VUS (largest-remainder rounding).
const TOTAL_VUS = Number(__ENV.VUS) || 10;
function allocateVus(items, total) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const exact = items.map((item) => (item.weight / totalWeight) * total);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((value, i) => ({ i, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (let k = 0; k < left; k++) counts[byRemainder[k].i] += 1;
  return counts;
}
const vusPerType = allocateVus(mix, TOTAL_VUS);
mix.forEach((m, i) => {
  m.vus = vusPerType[i];
  if (m.vus === 0) {
    throw new Error(`${m.type} gets 0 VUs at VUS=${TOTAL_VUS} -- raise VUS or drop it from LEDGER_MIX`);
  }
});

// ---------- The account codes: data/ledger/<PARTY_TYPE>.txt, one code per line (# lines ignored) ----------
const accountLists = {};
function accountsFor(ledgerType) {
  const party = LEDGER_TYPES[ledgerType];
  if (!accountLists[party]) {
    accountLists[party] = new SharedArray('ledger_accounts_' + party, function () {
      return open(`../data/ledger/${party}.txt`)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'));
    });
  }
  return accountLists[party];
}
mix.forEach((m) => {
  if (accountsFor(m.type).length === 0) {
    throw new Error(`No account codes for ${m.type} -- add one per line to data/ledger/${LEDGER_TYPES[m.type]}.txt`);
  }
});

// ---------- Query settings ----------
function isoDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}
const POSTING_DATE_FROM = __ENV.POSTING_DATE_FROM || isoDate(29); // last 30 days, like the captured screen
const POSTING_DATE_TO = __ENV.POSTING_DATE_TO || isoDate(0);
const PAGE_NUMBER = Number(__ENV.PAGE_NUMBER) || 0;
const PAGE_SIZE = Number(__ENV.PAGE_SIZE) || 10;

// Only the exact string 'true' enables per-iteration login (k6 env values are strings, so 'false' must not count as on).
const LOGIN_PER_ITERATION = __ENV.LOGIN_PER_ITERATION === 'true';

const emptyLedgers = new Counter('ledger_empty_responses');
const { logRequest, getLogs } = createRequestLogger('ledger_test.js');

// One k6 scenario per ledger type, each with its own number of VUs, all running at the same time.
// Without ITERATIONS_PER_VU each group holds its VUs constant for DURATION (default 30s).
const scenarios = {};
for (const m of mix) {
  scenarios[m.type] = __ENV.ITERATIONS_PER_VU
    ? {
        executor: 'per-vu-iterations',
        vus: m.vus,
        iterations: Number(__ENV.ITERATIONS_PER_VU),
        maxDuration: __ENV.DURATION || '5m',
        exec: 'ledgerView',
        env: { LEDGER_TYPE: m.type },
      }
    : {
        executor: 'constant-vus',
        vus: m.vus,
        duration: __ENV.DURATION || '30s',
        exec: 'ledgerView',
        env: { LEDGER_TYPE: m.type },
      };
}
export const options = { scenarios, thresholds: defaultOptions.thresholds };

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
// If any login fails the whole run aborts, so a bad account can't silently fire every call without a token.
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
    'reports/ledger-report.html': htmlReport(data),
    'reports/ledger-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/ledger-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

// Runs in every scenario; __ENV.LEDGER_TYPE says which ledger this group of VUs is looking at.
// Each iteration takes the next account from that type's list, so the accounts are spread across all the VUs
// (and cycle round if the list is shorter than the number of iterations).
export function ledgerView(data) {
  const ledgerType = __ENV.LEDGER_TYPE;
  const accounts = accountsFor(ledgerType);
  const accountRefId = accounts[exec.scenario.iterationInTest % accounts.length];

  let authHeaders;
  if (LOGIN_PER_ITERATION) {
    const user = users[Math.floor(Math.random() * users.length)];
    authHeaders = buildAuthHeaders(loginAndLog(user));
  } else {
    authHeaders = data.tokens[(__VU - 1) % data.tokens.length];
  }

  const call = buildLedgerRequest(authHeaders, {
    accountRefId,
    ledgerType,
    postingDateFrom: POSTING_DATE_FROM,
    postingDateTo: POSTING_DATE_TO,
    pageNumber: PAGE_NUMBER,
    pageSize: PAGE_SIZE,
  });

  const res = http.get(call.url, call.params);
  logRequest({
    apiName: ledgerApiName(ledgerType),
    requestMethod: 'GET',
    url: res.url,
    requestPayload: call.payload,
    statusCode: res.status,
    errorMessage: res.error || '',
    responseTime: res.timings?.duration,
    responseBody: res.body,
  });
  checkStatus200(res);

  // A ledger with no rows measures very little, so count them (cheap string test, no JSON parsing).
  if (res.status === 200 && typeof res.body === 'string' && res.body.includes('"totalItems":0')) {
    emptyLedgers.add(1);
  }

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (use for throughput tests).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 0;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
