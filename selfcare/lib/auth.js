import http from 'k6/http';
import { SELFCARE_BASE_URL } from '../../config.js';

export function selfCareLogin(username, password) {
  const url = `${SELFCARE_BASE_URL}/myrace-superapp//api/auth/login`;
  const payload = JSON.stringify({ username, password });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'EN',
      Platform: 'WEB_SELF_CARE',
      Origin: SELFCARE_BASE_URL,
      Referer: `${SELFCARE_BASE_URL}/auth/login`,
    },
  };

  return http.post(url, payload, params);
}
