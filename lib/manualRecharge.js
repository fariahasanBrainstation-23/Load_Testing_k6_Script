import http from 'k6/http';
import { BASE_URL } from '../config.js';

export function manualRecharge(authHeaders, sid, overrides = {}) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/transaction/manual-recharge`;

  const payload = JSON.stringify({
    reason: overrides.reason || 'RR-00002',
    amount: overrides.amount || 3000,
    rechargeDate: overrides.rechargeDate || new Date().toISOString(),
    receiptNumber: overrides.receiptNumber || `LOADTEST-${sid}-${Date.now()}`,
    collectionEntityId: overrides.collectionEntityId || __ENV.COLLECTION_ENTITY_ID || 'EID26000031',
    collectionEntityName: overrides.collectionEntityName || __ENV.COLLECTION_ENTITY_NAME || 'QA Load Sub Reseller 02',
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
  const response = http.post(url, payload, { headers });
  return { response, payload };
}
