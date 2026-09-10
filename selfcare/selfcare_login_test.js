import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { defaultOptions } from '../config.js';
import { selfCareLogin } from './lib/auth.js';
import { checkStatus200, checkHasJsonField } from '../lib/checks.js';
import { parseCsv } from './lib/csv.js';
import { createTokenLogger } from './lib/tokenLogger.js';

const credentials = new SharedArray('selfcare_credentials', function () {
  return parseCsv(open('./data/LoginCustomer.csv'));
});

const { logToken } = createTokenLogger();

// Logs in as each customer in data/LoginCustomer.csv exactly once, spread across VUS concurrent VUs.
export const options = {
  scenarios: {
    default: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS) || 1,
      iterations: credentials.length,
      maxDuration: __ENV.DURATION || '5m',
    },
  },
  thresholds: defaultOptions.thresholds,
};

export default function () {
  const cred = credentials[exec.scenario.iterationInTest];
  const res = selfCareLogin(cred.SID, cred.Password);

  const passed = checkStatus200(res) && checkHasJsonField(res, 'access_token');

  let token = '';
  if (passed) {
    try {
      token = res.json('access_token');
    } catch {
      token = '';
    }
  }

  logToken({
    sid: cred.SID,
    token,
    status: res.status,
    errorMessage: passed ? '' : res.error || `login failed (status ${res.status})`,
  });

  sleep(1);
}
