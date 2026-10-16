import { BASE_URL } from '../../config.js';

const DASHBOARD_URL = `${BASE_URL}/myrace-master-billing/api/v1/billing/dashboard/company`;

const DASHBOARD_CALLS = [
  { name: 'CUSTOMER_SUBBASE', method: 'POST', path: 'customer-subbase' },
  { name: 'ACTIVE_SUBBASE', method: 'GET', path: 'active-subbase' },
  { name: 'INACTIVE_SUBBASE', method: 'GET', path: 'inactive-subbase' },
  { name: 'NEW_CUSTOMER_GRAPH', method: 'GET', path: 'new-customer/graph' },
  { name: 'ENTITY_RECHARGE', method: 'GET', path: 'entity-recharge' },
  { name: 'CHANNEL_WISE_RECHARGE', method: 'GET', path: 'channel-wise-recharge' },
  { name: 'CUSTOMER_RECHARGE', method: 'GET', path: 'customer-recharge' },
  { name: 'CUSTOMER_INVOICE', method: 'GET', path: 'customer-invoice' },
  { name: 'NEW_PARTNER_SUMMARY', method: 'GET', path: 'new-partner/summary' },
  { name: 'DISCOUNTS', method: 'GET', path: 'discounts' },
  { name: 'ARPU', method: 'GET', path: 'arpu' },
  { name: 'SERVICE_PLAN_STATS', method: 'GET', path: 'service-plan-stats' },
  { name: 'REVENUE_SHARE', method: 'GET', path: 'revenue-share' },
  { name: 'UPCOMING_EXPIRE', method: 'GET', path: 'upcoming-expire/global-summary' },
];

// k6's http.batch only runs 6 requests at a time per host by default; the script sets batchPerHost to this so all
// of the calls really go out together.
export const COMPANY_DASHBOARD_CALL_COUNT = DASHBOARD_CALLS.length;

// URLSearchParams isn't available in k6's JS runtime -- build the query string manually.
function buildQueryString(pairs) {
  return pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

// For one company, returns all 14 calls ready for a single http.batch. `requests[i]` matches `meta[i]`, which carries
// the name, method and payload to log. Every GET takes companyCode/fromMonth/toMonth; the POST body is empty ({}) as
// captured, so customer-subbase is not filtered by company.
export function buildCompanyDashboardRequests(authHeaders, { companyCode, fromMonth, toMonth }) {
  const filter = companyCode ? [['companyCode', companyCode]] : [];
  const query = buildQueryString([...filter, ['fromMonth', fromMonth], ['toMonth', toMonth]]);
  const queryPayload = companyCode ? { companyCode, fromMonth, toMonth } : { fromMonth, toMonth };

  const requests = [];
  const meta = [];
  for (const def of DASHBOARD_CALLS) {
    const isPost = def.method === 'POST';
    requests.push({
      method: def.method,
      url: isPost ? `${DASHBOARD_URL}/${def.path}` : `${DASHBOARD_URL}/${def.path}?${query}`,
      body: isPost ? '{}' : null,
      params: {
        headers: isPost ? { ...authHeaders, 'Content-Type': 'application/json' } : authHeaders,
        tags: { name: `COMPANY_DASHBOARD_${def.name}` },
      },
    });
    meta.push({
      apiName: `COMPANY_DASHBOARD_${def.name}`,
      requestMethod: def.method,
      requestPayload: isPost ? {} : queryPayload,
    });
  }
  return { requests, meta };
}
