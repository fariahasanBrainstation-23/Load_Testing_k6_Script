import { BASE_URL } from '../../config.js';

// URLSearchParams isn't available in k6's JS runtime -- build the query string manually from [key, value] pairs.
function buildQueryString(pairs) {
  return pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

// Returns the two request objects for http.batch (list + summary), plus the query params as a payload object for logging.
// Parameter order matches the captured HAR for each call (the summary call orders them differently from the list call).
export function buildRechargeListRequests(authHeaders, filters = {}) {
  const sortBy = filters.sortBy || 'createdAt;DESC';
  const partyType = filters.partyType || 'CUSTOMER';
  const pageNumber = filters.pageNumber ?? 0;
  const pageSize = filters.pageSize ?? 10;

  const listPairs = [
    ['sortBy', sortBy],
    ['onlyChild', 'false'],
    ['partyType', partyType],
    ['pageNumber', pageNumber],
    ['pageSize', pageSize],
  ];

  const summaryPairs = [
    ['onlyChild', 'false'],
    ['partyType', partyType],
    ['sortBy', sortBy],
    ['pageNumber', pageNumber],
    ['pageSize', pageSize],
  ];

  const base = `${BASE_URL}/myrace-master-billing/api/v1/billing/report/recharge-list`;
  const params = { headers: authHeaders };

  return {
    list: { method: 'GET', url: `${base}?${buildQueryString(listPairs)}`, params },
    summary: { method: 'GET', url: `${base}/summary?${buildQueryString(summaryPairs)}`, params },
    payload: { sortBy, onlyChild: false, partyType, pageNumber, pageSize },
  };
}
