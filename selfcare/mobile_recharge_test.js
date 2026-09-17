import { check, sleep } from 'k6';
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
  getProfile,
  getOperators,
  getProducts,
  verifyTransactionAuth,
  initiateRecharge,
} from './lib/mobileRecharge.js';

const credentials = new SharedArray('selfcare_credentials', function () {
  return parseCsv(open('./data/LoginCustomer100.csv'));
});

const OPERATOR_CODE = __ENV.OPERATOR_CODE || 'TELETALK';
const REPEAT = Number(__ENV.REPEAT) || 1;
const { logRequest } = createRequestLogger('mobile_recharge_test.js');

// Recharges each customer in data/LoginCustomer100.csv REPEAT times (default 1), spread across VUS concurrent VUs.
// e.g. 3499 customers, REPEAT=2 -> 6998 total recharge flows, each customer hit 2 times.
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
    'reports/mobile_recharge-report.html': htmlReport(data),
    'reports/mobile_recharge-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/mobile_recharge-summary.json': JSON.stringify(data, null, 2),
  };
}

export default function () {
  const cred = credentials[exec.scenario.iterationInTest % credentials.length];

  const loginRes = selfCareLogin(cred.SID, cred.Password);
  logRequest({
    apiName: 'LOGIN',
    requestMethod: 'POST',
    url: loginRes.url,
    requestPayload: { SID: cred.SID, Password: cred.Password },
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

  const profileRes = getProfile(token);
  logRequest({
    apiName: 'PROFILE_ME',
    requestMethod: 'GET',
    url: profileRes.url,
    statusCode: profileRes.status,
    errorMessage: profileRes.error || '',
    responseTime: profileRes.timings?.duration,
    responseBody: profileRes.body,
  });
  if (!checkStatus200(profileRes)) {
    sleep(1);
    return;
  }
  const targetMsisdn = "01344017666";

  const operatorsRes = getOperators(token);
  logRequest({
    apiName: 'TOPUP_OPERATORS',
    requestMethod: 'GET',
    url: operatorsRes.url,
    statusCode: operatorsRes.status,
    errorMessage: operatorsRes.error || '',
    responseTime: operatorsRes.timings?.duration,
    responseBody: operatorsRes.body,
  });
  checkStatus200(operatorsRes);

  const productsRes = getProducts(token, OPERATOR_CODE);
  logRequest({
    apiName: 'TOPUP_PRODUCTS',
    requestMethod: 'GET',
    url: productsRes.url,
    statusCode: productsRes.status,
    errorMessage: productsRes.error || '',
    responseTime: productsRes.timings?.duration,
    responseBody: productsRes.body,
  });
  if (!checkStatus200(productsRes)) {
    sleep(1);
    return;
  }

  let productCode;
  try {
    productCode = productsRes.json('0.productCode');
  } catch {
    productCode = null;
  }

  if (!targetMsisdn || !productCode) {
    sleep(1);
    return;
  }

  const verifyRes = verifyTransactionAuth(token, cred.Password);
  logRequest({
    apiName: 'VERIFY_TRANSACTION_AUTH',
    requestMethod: 'POST',
    url: verifyRes.url,
    requestPayload: { method: 'PASSWORD', password: cred.Password },
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

  const { response: rechargeRes, payload: rechargePayload } = initiateRecharge(token, targetMsisdn, productCode, authorizationToken);
  logRequest({
    apiName: 'TOPUP_RECHARGE',
    requestMethod: 'POST',
    url: rechargeRes.url,
    requestPayload: rechargePayload,
    statusCode: rechargeRes.status,
    errorMessage: rechargeRes.error || '',
    responseTime: rechargeRes.timings?.duration,
    responseBody: rechargeRes.body,
  });
  check(rechargeRes, { 'status is 202': (r) => r.status === 202 });

  sleep(1);
}
