import http from 'k6/http';
import { BASE_URL } from '../config.js';

// Looks like a real UUID v4 (the server validated requestId as one in the HAR capture).
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function preloadPurchase(authHeaders, sid) {
  return http.get(`${BASE_URL}/myrace-master-billing/api/v1/billing/purchase/preload/${sid}`, { headers: authHeaders });
}

export function customerSummary(authHeaders, sid) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/customer/summary?searchText=${sid}&pageNumber=0&pageSize=5`;
  return http.get(url, { headers: authHeaders });
}

export function purchaseAll(authHeaders, sid) {
  const url =
    `${BASE_URL}/myrace-master-billing/api/v1/billing/purchase/all/${sid}` +
    `?pageNumber=0&pageSize=5&sortOrder=DESC&status=ACTIVE&status=SCHEDULE&status=SUSPEND` +
    `&sortBy=billingEndDate%3BDESC&findScheduleRequest=true`;
  return http.get(url, { headers: authHeaders });
}

export function eligiblePromotions(authHeaders, sid) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/offer/service-plan-promotion/eligible?customerCode=${sid}`;
  return http.get(url, { headers: authHeaders });
}

// Shared shape for both required-amount and create -- create additionally carries the services[].credential*
// fields and requestId, so callers build that part themselves (see buildCreatePayload below).
function basePurchaseFields(billingStartDate) {
  return {
    billingStartDate,
    billingType: 'BILLING_CYCLE',
    billingCycle: 'CALENDER_MONTH',
    billingFrequency: null,
    billingCustomEndDate: null,
    billingFixedDate: null,
    costFree: false,
    costFreeContinue: false,
    enableGracePayment: false,
    gracePaymentDate: null,
    note: '',
  };
}

export function buildRequiredAmountPayload({ serviceCode, billingStartDate }) {
  return { ...basePurchaseFields(billingStartDate), plans: [], services: [{ code: serviceCode }] };
}

// Captured once when the script starts (not per call), so every separate `k6 run` gets its own epoch and can
// never produce a PPPoE ID that collides with one from an earlier run, today or any other day.
const RUN_EPOCH36 = Date.now().toString(36);

// credential1/2 (PPPoE_ID / PPPoE_PASSWORD) must be unique per activation, forever -- reusing one already
// assigned (even in a past run) fails with "Same Pppoe User Id already exists". Uniqueness comes from two parts:
// RUN_EPOCH36 (this run can't collide with any other run) and iterationIndex (this call can't collide with any
// other call in this run -- k6's shared-iterations executor hands out a distinct index to every entry exactly
// once, regardless of VU count or timing, so this is a guarantee, not a probability). sidTail is only for a
// human reading the value to trace it back to a SID; it plays no part in uniqueness.
export function buildCreatePayload({ serviceCode, billingStartDate, sid, iterationIndex }) {
  const sidTail = sid.replace(/\D/g, '').slice(-6);
  const suffix = `${sidTail}${RUN_EPOCH36}${iterationIndex}`;
  return {
    ...basePurchaseFields(billingStartDate),
    plans: [],
    services: [
      {
        serviceCode,
        couponCode: '',
        credential1: { code: 'PPPoE_ID', value: `LT${suffix}` },
        credential2: { code: 'PPPoE_PASSWORD', value: `LtPass${suffix}` },
        autoRenew: true,
        autoRenewForEntity: false,
        credentialUpdateNextCycle: false,
        nextCredential1: { code: 'PPPoE_ID', value: null },
        nextCredential2: { code: 'PPPoE_PASSWORD', value: null },
      },
    ],
    requestId: uuidv4(),
  };
}

export function requiredAmount(authHeaders, sid, payload) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/purchase/required-amount/${sid}`;
  const headers = { ...authHeaders, 'Content-Type': 'application/json' };
  return http.post(url, JSON.stringify(payload), { headers });
}

export function createPurchase(authHeaders, sid, payload) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/purchase/create/${sid}`;
  const headers = { ...authHeaders, 'Content-Type': 'application/json' };
  return http.post(url, JSON.stringify(payload), { headers });
}

export function customerBalance(authHeaders, sid) {
  return http.get(`${BASE_URL}/myrace-master-billing/api/v1/billing/customer/balance/${sid}`, { headers: authHeaders });
}

export function entityBalance(authHeaders, entityCode) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/entity/balance?entityCode=${entityCode}`;
  return http.get(url, { headers: authHeaders });
}

export function dueAmount(authHeaders, sid) {
  return http.get(`${BASE_URL}/myrace-master-billing/api/v1/billing/purchase/due-amount/${sid}`, { headers: authHeaders });
}

export function createDetails(authHeaders, referenceId) {
  return http.get(`${BASE_URL}/myrace-master-billing/api/v1/billing/purchase/create/details/${referenceId}`, { headers: authHeaders });
}
