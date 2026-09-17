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

export function getProfile(token) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/profile/me`;
  return http.get(url, { headers: authHeaders(token) });
}

export function getOperators(token) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/topup/operators`;
  return http.get(url, { headers: authHeaders(token) });
}

export function getProducts(token, operatorCode, category = 'TOPUP') {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/topup/products?operatorCode=${operatorCode}&category=${category}`;
  return http.get(url, { headers: authHeaders(token) });
}

export function verifyTransactionAuth(token, password) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/profile/verify-transaction-auth`;
  const payload = JSON.stringify({ method: 'PASSWORD', password });
  return http.post(url, payload, { headers: authHeaders(token) });
}

// Simple RFC4122-ish v4 UUID generator (k6 has no built-in crypto.randomUUID).
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function initiateRecharge(token, targetMsisdn, productCode, authorizationToken, connectionType = 'PREPAID') {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/topup/recharge`;
  const payload = JSON.stringify({
    targetMsisdn,
    productCode,
    idempotencyKey: generateUuid(),
    authorizationToken,
    connectionType,
  });
  const response = http.post(url, payload, { headers: authHeaders(token) });
  return { response, payload };
}
