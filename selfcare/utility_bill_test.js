import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../lib/vendor/k6-summary.js';
import { defaultOptions } from '../config.js';
import { selfCareLogin } from './lib/auth.js';
import { parseCsv } from './lib/csv.js';
import { checkStatus200 } from '../lib/checks.js';
import { createRequestLogger } from '../lib/requestLogger.js';
import {
  getCategories,
  getBillerList,
  getMinimumBillAmount,
  calculateCharge,
  verifyTransactionAuth,
  payUtilityBill,
  getPaymentHistory,
} from './lib/utilityBill.js';

const credentials = new SharedArray('selfcare_credentials', function () {
  return parseCsv(open('./data/LoginCustomer100.csv'));
});

const CATEGORY_CODE = __ENV.CATEGORY_CODE || 'ELECTRICITY';
const BILLER_CODE = __ENV.BILLER_CODE || 'DESCOPREPAID';
const ACCOUNT_NUMBER = __ENV.ACCOUNT_NUMBER || '12334568334';
const BILL_AMOUNT = Number(__ENV.BILL_AMOUNT) || 500;
const BILLING_MONTH = __ENV.BILLING_MONTH || '09-2026';
const MOBILE_NUMBER = __ENV.MOBILE_NUMBER || '01344017666';
const REPEAT = Number(__ENV.REPEAT) || 1;

const { logRequest } = createRequestLogger('utility_bill_test.js');

// Runs the utility bill flow for each customer in data/LoginCustomer100.csv REPEAT times (default 1),
// spread across VUS concurrent VUs. e.g. 100 customers, REPEAT=2 -> 200 total flows.
export const options = {
  scenarios: {
    default: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS) || 1,
      iterations: credentials.length * REPEAT,
      maxDuration: __ENV.DURATION || '50m',
    },
  },
  thresholds: defaultOptions.thresholds,
};

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/utility_bill-report.html': htmlReport(data),
    'reports/utility_bill-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/utility_bill-summary.json': JSON.stringify(data, null, 2),
  };
}

export default function () {
  const cred = credentials[exec.scenario.iterationInTest % credentials.length];

  const loginRes = selfCareLogin(cred.SID, cred.Password);
  logRequest({
    apiName: 'LOGIN',
    requestMethod: 'POST',
    url: loginRes.url,
    requestPayload: { username: cred.SID, password: cred.Password },
    statusCode: loginRes.status,
    errorMessage: loginRes.error || '',
    responseTime: loginRes.timings?.duration,
    responseBody: loginRes.body,
  });
  if (!checkStatus200(loginRes)) {
    sleep(1);
    return;
  }
  const token = loginRes.json('access_token');

  const categoriesRes = getCategories(token);
  logRequest({
    apiName: 'UTILITY_BILL_CATEGORY',
    requestMethod: 'GET',
    url: categoriesRes.url,
    statusCode: categoriesRes.status,
    errorMessage: categoriesRes.error || '',
    responseTime: categoriesRes.timings?.duration,
    responseBody: categoriesRes.body,
  });
  checkStatus200(categoriesRes);

  const billerRes = getBillerList(token, CATEGORY_CODE);
  logRequest({
    apiName: 'UTILITY_BILL_BILLER_LIST',
    requestMethod: 'GET',
    url: billerRes.url,
    statusCode: billerRes.status,
    errorMessage: billerRes.error || '',
    responseTime: billerRes.timings?.duration,
    responseBody: billerRes.body,
  });
  checkStatus200(billerRes);

  const minAmountRes = getMinimumBillAmount(token);
  logRequest({
    apiName: 'UTILITY_BILL_MINIMUM_AMOUNT',
    requestMethod: 'GET',
    url: minAmountRes.url,
    statusCode: minAmountRes.status,
    errorMessage: minAmountRes.error || '',
    responseTime: minAmountRes.timings?.duration,
    responseBody: minAmountRes.body,
  });
  checkStatus200(minAmountRes);

  const chargeRes = calculateCharge(token, BILL_AMOUNT);
  logRequest({
    apiName: 'UTILITY_BILL_CALCULATE_CHARGE',
    requestMethod: 'GET',
    url: chargeRes.url,
    statusCode: chargeRes.status,
    errorMessage: chargeRes.error || '',
    responseTime: chargeRes.timings?.duration,
    responseBody: chargeRes.body,
  });
  if (!checkStatus200(chargeRes)) {
    sleep(1);
    return;
  }

  const { response: verifyRes, payload: verifyPayload } = verifyTransactionAuth(token, cred.Password);
  logRequest({
    apiName: 'VERIFY_TRANSACTION_AUTH',
    requestMethod: 'POST',
    url: verifyRes.url,
    requestPayload: verifyPayload,
    statusCode: verifyRes.status,
    errorMessage: verifyRes.error || '',
    responseTime: verifyRes.timings?.duration,
    responseBody: verifyRes.body,
  });
  if (!checkStatus200(verifyRes)) {
    sleep(1);
    return;
  }

  let authorizationToken;
  try {
    authorizationToken = verifyRes.json('authorizationToken');
  } catch {
    authorizationToken = null;
  }

  if (!authorizationToken) {
    sleep(1);
    return;
  }

  // 202 here only means the request was accepted and submitted to the biller/provider
  // (response status field is "PROVIDER_SUBMITTED") -- it does NOT confirm the payment
  // actually completed. Real completion must be confirmed via payment history below.
  const { response: paymentRes, payload: paymentPayload } = payUtilityBill(
    token,
    BILLER_CODE,
    ACCOUNT_NUMBER,
    MOBILE_NUMBER,
    BILLING_MONTH,
    BILL_AMOUNT,
    authorizationToken
  );
  logRequest({
    apiName: 'UTILITY_BILL_PAYMENT_SUBMIT',
    requestMethod: 'POST',
    url: paymentRes.url,
    requestPayload: paymentPayload,
    statusCode: paymentRes.status,
    errorMessage: paymentRes.error || '',
    responseTime: paymentRes.timings?.duration,
    responseBody: paymentRes.body,
  });
  const submitted = paymentRes.status === 202;
  if (!submitted) {
    sleep(1);
    return;
  }

  let requestCode;
  try {
    requestCode = paymentRes.json('requestCode');
  } catch {
    requestCode = null;
  }

  sleep(1);

  // Poll payment history once to check the real terminal status (not just the 202 hand-off).
  const historyRes = getPaymentHistory(token, 0, 8);
  logRequest({
    apiName: 'UTILITY_BILL_PAYMENT_HISTORY',
    requestMethod: 'GET',
    url: historyRes.url,
    statusCode: historyRes.status,
    errorMessage: historyRes.error || '',
    responseTime: historyRes.timings?.duration,
    responseBody: historyRes.body,
  });
  checkStatus200(historyRes);

  if (requestCode) {
    try {
      const items = historyRes.json('data');
      const match = Array.isArray(items) ? items.find((it) => it.requestCode === requestCode) : null;
      if (match) {
        console.log(`Payment ${requestCode} status: ${match.status}`);
      }
    } catch {
      // ignore parse errors, history call itself is already checked/logged above
    }
  }

  sleep(1);
}
