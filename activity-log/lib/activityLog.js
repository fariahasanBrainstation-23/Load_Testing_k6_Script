import http from 'k6/http';
import { BASE_URL } from '../../config.js';

// URLSearchParams isn't available in k6's JS runtime -- build query strings manually.
function buildQueryString(query) {
  return Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function getActionCodes(authHeaders) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/activity-log/action-code`;
  return http.get(url, { headers: authHeaders });
}

export function getSystemUserActivityLog(authHeaders, filters = {}) {
  const query = {
    pageNumber: filters.pageNumber ?? 0,
    pageSize: filters.pageSize ?? 10,
    sortBy: filters.sortBy || 'createdDate',
    sortOrder: filters.sortOrder || 'DESC',
  };
  if (filters.actionCode) query.actionCode = filters.actionCode;
  if (filters.status) query.status = filters.status;
  if (filters.username) query.username = filters.username;

  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/activity-log/system-user?${buildQueryString(query)}`;
  return http.get(url, { headers: authHeaders });
}

export function getCustomerActionCodes(authHeaders) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/activity-log/action-code-superapp`;
  return http.get(url, { headers: authHeaders });
}

export function getCustomerActivityLog(authHeaders, filters = {}) {
  const query = {
    pageNumber: filters.pageNumber ?? 0,
    pageSize: filters.pageSize ?? 10,
    sortBy: filters.sortBy || 'createdDate',
    sortOrder: filters.sortOrder || 'DESC',
  };
  if (filters.username) query.username = filters.username;
  if (filters.actionCode) query.actionCode = filters.actionCode;
  if (filters.status) query.status = filters.status;

  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/activity-log/customer?${buildQueryString(query)}`;
  return http.get(url, { headers: authHeaders });
}
