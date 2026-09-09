import http from 'k6/http';
import { BASE_URL } from '../config.js';

export function login(username, password) {
  const url = `${BASE_URL}/myrace-master-billing/auth/login`;
  const payload = JSON.stringify({ username, password });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/auth/login`,
    },
  };

  return http.post(url, payload, params);
}

export function buildAuthHeaders(loginResponse, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const body = loginResponse.json();
  if (body && body.access_token) {
    headers.Authorization = `Bearer ${body.access_token}`;
  }
  return headers;
}
