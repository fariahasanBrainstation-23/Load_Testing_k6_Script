import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { defaultOptions } from '../config.js';
import { initiateOnlineRecharge } from './lib/onlineRecharge.js';
import { checkStatus200 } from '../lib/checks.js';
import { parseCsv } from './lib/csv.js';

const customers = new SharedArray('customer_tokens', function () {
  return parseCsv(open('./data/CustomerIdToken.csv'));
});

const AMOUNT = Number(__ENV.AMOUNT) || 500;

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU recharge attempts independently.
// e.g. VUS=5, ITERATIONS_PER_VU=2 -> 5 VUs x 2 = 10 recharges total.
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
  const customer = customers[Math.floor(Math.random() * customers.length)];
  const res = initiateOnlineRecharge(customer.Token, AMOUNT);

  checkStatus200(res);

  sleep(1);
}
