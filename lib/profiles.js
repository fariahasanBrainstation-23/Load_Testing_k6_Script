// Shared PROFILE (smoke/ramp/soak/spike) executor builder -- opt-in per script, not global. Every script that uses
// this still supplies its own list length, so the caller decides what "VUS bigger than the list" means for it.
//
// Usage in a script:
//   const { options, indexFor } = buildProfileOptions({ listLength: sids.length });
//   export { options };
//   ...
//   const item = list[indexFor(exec, __VU, __ITER) % list.length];
//
// (no PROFILE)  shared-iterations : VUS workers, each list item used exactly once, stops when the list is done
// PROFILE=smoke : constant-vus     : a few VUs for a short duration      (default VUS=3,  DURATION=30s)
// PROFILE=ramp  : ramping-vus      : 0 -> VUS over RAMP_DURATION         (default VUS=100, RAMP_DURATION=10m)
// PROFILE=soak  : constant-vus     : fixed VUS held for a long duration  (default VUS=10, DURATION=5m)
// PROFILE=spike : ramping-vus      : quick jump to VUS, hold, quick drop (default VUS=100, SPIKE_UP=10s, SPIKE_HOLD=30s, SPIKE_DOWN=10s)
//
// smoke/ramp/soak/spike run for a fixed TIME, not a fixed count -- once they use up every item in the list they
// wrap back around to the start, so the same real account/SID can be hit more than once in one run.
export function buildProfileOptions({ listLength, thresholds } = {}) {
  const PROFILE = __ENV.PROFILE || null;
  const VUS = Number(__ENV.VUS) || (PROFILE === 'smoke' ? 3 : PROFILE === 'soak' ? 10 : 100);

  let options;

  if (!PROFILE) {
    options = {
      scenarios: {
        default: {
          executor: 'shared-iterations',
          vus: Math.min(VUS, listLength),
          iterations: listLength,
          maxDuration: __ENV.DURATION || '30m',
        },
      },
    };
  } else if (PROFILE === 'smoke') {
    options = {
      scenarios: {
        default: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '30s' },
      },
    };
  } else if (PROFILE === 'ramp') {
    options = {
      scenarios: {
        default: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [{ duration: __ENV.RAMP_DURATION || '10m', target: VUS }],
        },
      },
    };
  } else if (PROFILE === 'soak') {
    options = {
      scenarios: {
        default: { executor: 'constant-vus', vus: VUS, duration: __ENV.DURATION || '5m' },
      },
    };
  } else if (PROFILE === 'spike') {
    options = {
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
  } else {
    throw new Error(`Unknown PROFILE "${PROFILE}" -- expected smoke, ramp, soak or spike (or leave PROFILE unset)`);
  }

  if (thresholds) options.thresholds = thresholds;

  // Default mode: exec.scenario.iterationInTest is a unique 0..N-1 index across all VUs (each item used once).
  // Duration-based profiles: interleave by VU so VU1 gets item 1,VUS+1,2*VUS+1,..., VU2 gets item 2,VUS+2,...
  // instead of every VU hitting the same item in the same iteration (a real bug caught and fixed in
  // forget_password_test.js -- an offset that's a multiple of the list length cancels out and collides).
  function indexFor(exec, vuNumber, iterNumber) {
    return PROFILE ? iterNumber * VUS + (vuNumber - 1) : exec.scenario.iterationInTest;
  }

  return { options, indexFor, PROFILE, VUS };
}
