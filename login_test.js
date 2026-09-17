import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { htmlReport } from './lib/vendor/k6-reporter.bundle.js';
import { textSummary } from './lib/vendor/k6-summary.js';
import { defaultOptions } from './config.js';
import { login } from './lib/auth.js';
import { checkStatus200, checkHasJsonField } from './lib/checks.js';

const users = new SharedArray('users', function () {
  return JSON.parse(open('./data/users.json'));
});

// VUS + ITERATIONS_PER_VU: each VU runs ITERATIONS_PER_VU login attempts independently.
// e.g. VUS=5, ITERATIONS_PER_VU=2 -> 5 VUs x 2 = 10 logins total.
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

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/login-report.html': htmlReport(data),
    'reports/login-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/login-summary.json': JSON.stringify(data, null, 2),
  };
}

export default function () {
  const user = users[Math.floor(Math.random() * users.length)];
  const res = login(user.username, user.password);

  checkStatus200(res);
  checkHasJsonField(res, 'access_token');

  sleep(1);
}
