import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../../lib/vendor/k6-summary.js';
import { defaultOptions } from '../../config.js';
import { parseCsv } from '../lib/csv.js';
import { checkStatus200 } from '../../lib/checks.js';
import { createRequestLogger } from '../../lib/requestLogger.js';
import { buildProfileOptions } from '../../lib/profiles.js';
import { getLoyaltyHistory } from './lib/loyaltyHistory.js';

// Uses stored tokens instead of logging in each iteration -- see selfcare/data/CustomerIdToken.csv
// (generated via `npm run selfcare-tokens`, same workflow as online_recharge_test.js).
const customers = new SharedArray('customer_tokens', function () {
  return parseCsv(open('../data/CustomerIdToken.csv'));
});

const PAGE_NUMBER = Number(__ENV.PAGE_NUMBER) || 0;
const PAGE_SIZE = Number(__ENV.PAGE_SIZE) || 10;
const REPEAT = Number(__ENV.REPEAT) || 1;

const { logRequest } = createRequestLogger('loyalty_history_test.js');

// PROFILE=smoke/ramp/soak/spike switches to a fixed-duration run that cycles through the token list (see
// lib/profiles.js). Leave PROFILE unset for the default: each customer checked REPEAT times, then stop.
const { options, indexFor } = buildProfileOptions({
  listLength: customers.length * REPEAT,
  thresholds: defaultOptions.thresholds,
});
export { options };

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/loyalty_history-report.html': htmlReport(data),
    'reports/loyalty_history-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/loyalty_history-summary.json': JSON.stringify(data, null, 2),
  };
}

export default function () {
  const index = indexFor(exec, __VU, __ITER);
  const customer = customers[index % customers.length];

  // The three main loyalty history APIs (same endpoint, three historyType values -- matches the UI's EARN/REDEEM/EXPIRE tabs).
  for (const historyType of ['EARN', 'REDEEM', 'EXPIRE']) {
    const res = getLoyaltyHistory(customer.Token, historyType, PAGE_NUMBER, PAGE_SIZE);
    logRequest({
      apiName: `LOYALTY_HISTORY_${historyType}`,
      requestMethod: 'GET',
      url: res.url,
      requestPayload: { historyType, pageNumber: PAGE_NUMBER, pageSize: PAGE_SIZE },
      statusCode: res.status,
      errorMessage: res.error || '',
      responseTime: res.timings?.duration,
      responseBody: res.body,
    });
    checkStatus200(res);
  }

}
