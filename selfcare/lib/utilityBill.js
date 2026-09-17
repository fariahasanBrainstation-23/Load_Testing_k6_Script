import http from 'k6/http';
import { SELFCARE_BASE_URL } from '../../config.js';

function authHeaders(token, extra = {}) {
  return {
    'Content-Type': 'application/json',
    Platform: 'WEB_SELF_CARE',
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

// Simple RFC4122-ish v4 UUID generator (k6 has no built-in crypto.randomUUID).
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getCategories(token) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/utility-bill/category`;
  return http.get(url, { headers: authHeaders(token) });
}

export function getBillerList(token, categoryCode) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/utility-bill/biller?categoryCode=${categoryCode}`;
  return http.get(url, { headers: authHeaders(token) });
}

export function getMinimumBillAmount(token) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/utility-bill/minimum-bill-amount`;
  return http.get(url, { headers: authHeaders(token) });
}

export function calculateCharge(token, billAmount) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/utility-bill/calculate-charge?billAmount=${billAmount}`;
  return http.get(url, { headers: authHeaders(token) });
}

export function verifyTransactionAuth(token, password) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/profile/verify-transaction-auth`;
  const payload = JSON.stringify({ method: 'PASSWORD', password });
  const response = http.post(url, payload, { headers: authHeaders(token) });
  return { response, payload };
}

export function payUtilityBill(token, billerCode, accountNumber, mobileNumber, billingMonth, amount, authorizationToken) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/utility-bill/payment`;
  const payload = JSON.stringify({
    billerCode,
    accountNumber,
    mobileNumber,
    billingMonth,
    amount: String(amount),
    idempotencyKey: generateUuid(),
    authorizationToken,
  });
  const response = http.post(url, payload, { headers: authHeaders(token) });
  return { response, payload };
}

export function getPaymentHistory(token, page = 0, size = 8) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/utility-bill/payment/history?page=${page}&size=${size}`;
  return http.get(url, { headers: authHeaders(token) });
}
