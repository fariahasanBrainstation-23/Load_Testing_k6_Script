import { BASE_URL } from '../../config.js';

// Every ledger type belongs to a party type; the account codes for a party type live in data/ledger/<PARTY_TYPE>.txt.
// The two entity ledgers (payment and invoice) look up the same entity codes, so they share ENTITY.txt.
export const LEDGER_TYPES = {
  CUSTOMER_LEDGER: 'CUSTOMER',
  ENTITY_PAYMENT_LEDGER: 'ENTITY',
  ENTITY_INVOICE_LEDGER: 'ENTITY',
  SALES_PERSON_LEDGER: 'SALES_PERSON',
  BROKER_PERSON_LEDGER: 'BROKER_PERSON',
  REFERRAL_EMPLOYEE_LEDGER: 'REFERRAL_EMPLOYEE',
  COMPANY_VAT_LEDGER: 'COMPANY_VAT',
};

// e.g. CUSTOMER_LEDGER -> LEDGER_CUSTOMER, ENTITY_INVOICE_LEDGER -> LEDGER_ENTITY_INVOICE. Only 7 possible values,
// so the report's API Summary shows one row per ledger type.
export function ledgerApiName(ledgerType) {
  return `LEDGER_${ledgerType.replace(/_LEDGER$/, '')}`;
}

// URLSearchParams isn't available in k6's JS runtime, and sortBy is a repeated key, so build the query string
// manually from [key, value] pairs (same order as the captured HAR).
function buildQueryString(pairs) {
  return pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

// The main ledger call: GET /ledger?accountRefId=<code>&...&ledgerType=<type>
export function buildLedgerRequest(authHeaders, { accountRefId, ledgerType, postingDateFrom, postingDateTo, pageNumber, pageSize }) {
  const query = buildQueryString([
    ['accountRefId', accountRefId],
    ['sortBy', 'postingDate;asc'],
    ['sortBy', 'txnDateTime;asc'],
    ['pageNumber', pageNumber],
    ['pageSize', pageSize],
    ['postingDateFrom', postingDateFrom],
    ['postingDateTo', postingDateTo],
    ['ledgerType', ledgerType],
  ]);

  return {
    url: `${BASE_URL}/myrace-master-billing/api/v1/billing/ledger?${query}`,
    params: { headers: authHeaders, tags: { name: ledgerApiName(ledgerType), ledger_type: ledgerType } },
    payload: { accountRefId, ledgerType, postingDateFrom, postingDateTo, pageNumber, pageSize },
  };
}
