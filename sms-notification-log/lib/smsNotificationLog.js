import http from 'k6/http';
import { BASE_URL } from '../../config.js';

// URLSearchParams isn't available in k6's JS runtime -- build query strings manually.
function buildQueryString(query) {
  return Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function getSmsNotificationLog(authHeaders, filters = {}) {
  const query = {
    pageNumber: filters.pageNumber ?? 0,
    pageSize: filters.pageSize ?? 10,
    sortBy: filters.sortBy || 'dateTime',
    sortOrder: filters.sortOrder || 'DESC',
  };
  if (filters.deliveryStatus) query.deliveryStatus = filters.deliveryStatus;

  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/external/notification/sms-notification-log?${buildQueryString(query)}`;
  return http.get(url, { headers: authHeaders });
}
