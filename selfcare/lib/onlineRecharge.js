import http from 'k6/http';
import { SELFCARE_BASE_URL } from '../../config.js';

export function initiateOnlineRecharge(token, amount, offerCode = null) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp/api/v1/superapp/recharge/sslcommerz/load-test/initiate`;
  const payload = JSON.stringify({ amount, offerCode });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Platform: 'ANDROID',
      Authorization: `Bearer ${token}`,
    },
  };

  return http.post(url, payload, params);
}
