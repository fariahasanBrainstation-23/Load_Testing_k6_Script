import { BASE_URL } from '../../config.js';

// URLSearchParams isn't available in k6's JS runtime, and billingStatuses is a repeated key,
// so build the query string manually from [key, value] pairs.
function buildQueryString(pairs) {
  return pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

// Returns the two request objects for http.batch (list + summary), plus the query params as a payload object for logging.
// Parameter order matches the captured HAR for each call (the summary call orders them differently from the list call).
export function buildBtrcReportRequests(authHeaders, filters = {}) {
  const sortBy = filters.sortBy || 'createdAt;DESC';
  const billingStatuses = filters.billingStatuses || ['ACTIVE'];
  const pageNumber = filters.pageNumber ?? 0;
  const pageSize = filters.pageSize ?? 10;

  const statusPairs = billingStatuses.map((status) => ['billingStatuses', status]);

  const listPairs = [
    ['sortBy', sortBy],
    ['onlyChild', 'false'],
    ...statusPairs,
    ['pageNumber', pageNumber],
    ['pageSize', pageSize],
  ];

  const summaryPairs = [
    ['onlyChild', 'false'],
    ...statusPairs,
    ['sortBy', sortBy],
    ['pageNumber', pageNumber],
    ['pageSize', pageSize],
  ];

  const base = `${BASE_URL}/myrace-master-billing/api/v1/billing/report/btrc-list`;
  const params = { headers: authHeaders };

  return {
    list: { method: 'GET', url: `${base}?${buildQueryString(listPairs)}`, params },
    summary: { method: 'GET', url: `${base}/summary?${buildQueryString(summaryPairs)}`, params },
    payload: { sortBy, onlyChild: false, billingStatuses, pageNumber, pageSize },
  };
}
