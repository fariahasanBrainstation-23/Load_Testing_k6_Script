import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { defaultOptions } from './config.js';
import { login } from './lib/auth.js';
import { checkStatus200, checkHasJsonField } from './lib/checks.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./data/users.json'));
});

export const options = __ENV.MAX_REQUESTS
  ? { vus: 1, iterations: Number(__ENV.MAX_REQUESTS), thresholds: defaultOptions.thresholds }
  : defaultOptions;

export default function () {
  const user = users[Math.floor(Math.random() * users.length)];
  const res = login(user.username, user.password);

  checkStatus200(res);
  checkHasJsonField(res, 'access_token');

  sleep(1);
}
