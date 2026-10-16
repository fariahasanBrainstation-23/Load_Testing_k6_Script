import { sleep } from 'k6';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { htmlReport } from '../../lib/vendor/k6-reporter.bundle.js';
import { textSummary } from '../../lib/vendor/k6-summary.js';
import { checkStatus200 } from '../../lib/checks.js';
import { createRequestLogger } from '../../lib/requestLogger.js';
import { requestOtp } from './lib/forgetPassword.js';

// One SID (or phone number) per line (lines starting with # are ignored). Path is relative to this script.
// WARNING: every request triggers a real OTP SMS to that customer's real phone number.
const SIDS_FILE = __ENV.SIDS_FILE || '../data/forget_password_sids.txt';
const sids = new SharedArray('forget_password_sids', function () {
  return open(SIDS_FILE)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
});
if (sids.length === 0) {
  throw new Error(`No SIDs found in ${SIDS_FILE} -- add one per line (lines starting with # are ignored)`);
}

// PROFILE selects which of the 4 standard load profiles to run. Leave unset for the default "process the whole
// SID list exactly once" mode (each SID hit exactly once, no PROFILE needed).
//
//   (no PROFILE)  shared-iterations : VUS workers, each SID used exactly once, stops when the list is done
//   PROFILE=smoke : constant-vus     : a few VUs for a short duration      (default VUS=3,  DURATION=30s)
//   PROFILE=ramp  : ramping-vus      : 0 -> VUS over RAMP_DURATION         (default VUS=100, RAMP_DURATION=10m)
//   PROFILE=soak  : constant-vus     : fixed VUS held for a long duration  (default VUS=10, DURATION=30m)
//   PROFILE=spike : ramping-vus      : quick jump to VUS, hold, quick drop (default VUS=100, SPIKE_UP=10s, SPIKE_HOLD=30s, SPIKE_DOWN=10s)
//
// smoke/ramp/soak/spike all run for a fixed TIME, not a fixed count -- once they use up every SID in the list they
// wrap back around to the start (SID #1 again), so the same real customer can be hit more than once in one run.
const PROFILE = __ENV.PROFILE || null;
const VUS = Number(__ENV.VUS) || (PROFILE === 'smoke' ? 3 : PROFILE === 'soak' ? 10 : 100);

function buildOptions() {
  if (!PROFILE) {
    // Default: process the SID list exactly once, VUS workers picking up the next unused SID as they finish.
    return {
      scenarios: {
        default: {
          executor: 'shared-iterations',
          vus: Math.min(VUS, sids.length),
          iterations: sids.length,
          maxDuration: __ENV.DURATION || '30m',
        },
      },
    };
  }

  if (PROFILE === 'smoke') {
    return {
      scenarios: {
        default: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '30s' },
      },
    };
  }

  if (PROFILE === 'ramp') {
    return {
      scenarios: {
        default: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [{ duration: __ENV.RAMP_DURATION || '10m', target: VUS }],
        },
      },
    };
  }

  if (PROFILE === 'soak') {
    return {
      scenarios: {
        default: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '5m' },
      },
    };
  }

  if (PROFILE === 'spike') {
    return {
      scenarios: {
        default: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: __ENV.SPIKE_UP || '10s', target: VUS },
            { duration: __ENV.SPIKE_HOLD || '30s', target: VUS },
            { duration: __ENV.SPIKE_DOWN || '10s', target: 0 },
          ],
        },
      },
    };
  }

  throw new Error(`Unknown PROFILE "${PROFILE}" -- expected smoke, ramp, soak or spike (or leave PROFILE unset)`);
}

export const options = buildOptions();

const { logRequest, getLogs } = createRequestLogger('forget_password_test.js');

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'reports/forget_password-report.html': htmlReport(data),
    'reports/forget_password-summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    'reports/summary.json': JSON.stringify(data, null, 2),
    'reports/forget_password-log.json': JSON.stringify(getLogs(), null, 2),
  };
}

export default function () {
  // Default mode: exec.scenario.iterationInTest is a unique 0..N-1 index across all VUs (each SID used once).
  // Duration-based profiles (smoke/ramp/soak/spike): interleave by VU so VU1 gets SID 1,6,11,..., VU2 gets
  // SID 2,7,12,... (for VUS=5) instead of every VU hitting the same SID in the same iteration. Wraps around
  // with modulo once the list is exhausted -- this is the "cycle back to SID #1" reuse.
  const index = PROFILE ? __ITER * VUS + (__VU - 1) : exec.scenario.iterationInTest;
  const sid = sids[index % sids.length];

  const { response, payload } = requestOtp(sid);
  logRequest({
    apiName: 'FORGOT_USER_OTP',
    requestMethod: 'POST',
    url: response.url,
    requestPayload: payload,
    statusCode: response.status,
    errorMessage: response.error || '',
    responseTime: response.timings?.duration,
    responseBody: response.body,
  });
  checkStatus200(response);

  // SLEEP=0 removes think-time so each VU sends as fast as the server answers (use for throughput tests).
  const sleepSeconds = __ENV.SLEEP !== undefined ? Number(__ENV.SLEEP) : 0;
  if (sleepSeconds > 0) sleep(sleepSeconds);
}
