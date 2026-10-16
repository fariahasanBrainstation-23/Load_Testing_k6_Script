import http from 'k6/http';
import { SELFCARE_BASE_URL } from '../../../config.js';

export function getLoyaltyHistory(token, historyType, pageNumber = 0, pageSize = 10) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/loyalty/history?historyType=${historyType}&pageNumber=${pageNumber}&pageSize=${pageSize}`;
  return http.get(url, {
    headers: { Platform: 'WEB_SELF_CARE', Authorization: `Bearer ${token}` },
    tags: { name: `LOYALTY_HISTORY_${historyType}` },
  });
}
