import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { defaultOptions } from '../config.js';
import { initiateOnlineRecharge } from './lib/onlineRecharge.js';
import { checkStatus200 } from '../lib/checks.js';
import { parseCsv } from './lib/csv.js';
import { createRequestLogger } from '../lib/requestLogger.js';

const customers = new SharedArray('customer_tokens', function () {
  return parseCsv(open('./data/CustomerIdToken.csv'));
});

const AMOUNT = Number(__ENV.AMOUNT) || 500;

const { logRequest } = createRequestLogger('online_recharge_test.js');

// Recharges each customer in data/CustomerIdToken.csv exactly once, spread across VUS concurrent VUs.
export const options = {
  scenarios: {
    default: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS) || 1,
      iterations: customers.length,
      maxDuration: __ENV.DURATION || '5m',
    },
  },
  thresholds: defaultOptions.thresholds,
};

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/online_recharge-report.html': htmlReport(data),
    'reports/online_recharge-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/online_recharge-summary.json': JSON.stringify(data, null, 2),
  };
}

export default function () {
  const customer = customers[exec.scenario.iterationInTest];
  const res = initiateOnlineRecharge(customer.Token, AMOUNT);

  logRequest({
    apiName: 'ONLINE_RECHARGE_INITIATE',
    requestMethod: 'POST',
    url: res.url,
    statusCode: res.status,
    errorMessage: res.error || '',
    responseTime: res.timings?.duration,
    responseBody: res.body,
  });
  checkStatus200(res);

  sleep(1);
}
