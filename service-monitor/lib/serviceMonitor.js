import http from 'k6/http';
import { BASE_URL } from '../../config.js';

// URLSearchParams isn't available in k6's JS runtime -- build query strings manually.
function buildQueryString(query) {
  return Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function getPurchaseThirdParty(authHeaders, filters = {}) {
  const query = {
    partyType: filters.partyType || 'CUSTOMER',
    status: filters.status || 'ACTIVE',
    detailsStatus: filters.detailsStatus || 'FAILED',
    pageNumber: filters.pageNumber ?? 0,
    pageSize: filters.pageSize ?? 10,
  };

  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/activity-log/purchase-third-party?${buildQueryString(query)}`;
  return http.get(url, { headers: authHeaders });
}
