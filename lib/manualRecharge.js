import http from 'k6/http';
import { BASE_URL } from '../config.js';

export function manualRecharge(authHeaders, sid, overrides = {}) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/transaction/manual-recharge`;

  const payload = JSON.stringify({
    reason: overrides.reason || 'RR-00002',
    amount: overrides.amount || 300,
    rechargeDate: overrides.rechargeDate || new Date().toISOString(),
    receiptNumber: overrides.receiptNumber || `LOADTEST-${sid}-${Date.now()}`,
    collectionEntityId: overrides.collectionEntityId || __ENV.COLLECTION_ENTITY_ID || 'EID26000159',
    collectionEntityName: overrides.collectionEntityName || __ENV.COLLECTION_ENTITY_NAME || 'Ramij Reseller',
    note: overrides.note || null,
    channel: overrides.channel || __ENV.CHANNEL || 'BKASH_PGW',
    bankCode: overrides.bankCode || null,
    branchCode: overrides.branchCode || null,
    bankAccountName: overrides.bankAccountName || null,
    bankAccountNumber: overrides.bankAccountNumber || null,
    document: overrides.document || null,
    offerCode: overrides.offerCode || null,
    receiverType: 'CUSTOMER',
    receiverRefId: sid,
  });

  const headers = { ...authHeaders, 'Content-Type': 'application/json' };
  return http.post(url, payload, { headers });
}
