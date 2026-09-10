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

export const options = __ENV.MAX_REQUESTS
  ? { vus: 1, iterations: Number(__ENV.MAX_REQUESTS), thresholds: defaultOptions.thresholds }
  : defaultOptions;

export default function () {
  const customer = customers[Math.floor(Math.random() * customers.length)];
  const res = initiateOnlineRecharge(customer.Token, AMOUNT);

  checkStatus200(res);

  sleep(1);
}
