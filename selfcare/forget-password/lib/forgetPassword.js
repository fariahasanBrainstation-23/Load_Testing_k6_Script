import http from 'k6/http';
import { SELFCARE_BASE_URL } from '../../../config.js';

const FORGOT_USER_URL = `${SELFCARE_BASE_URL}/myrace-superapp/api/auth/forgot-user`;

// Public endpoint -- no login/token needed (unlike almost every other script in this project).
export function requestOtp(sid, overrides = {}) {
  const payload = {
    eventCode: overrides.eventCode || __ENV.EVENT_CODE || 'USER-OTP-PUBLIC',
    phoneNumberOrCustomerCode: sid,
    deviceId: overrides.deviceId || __ENV.DEVICE_ID || 'web-uuid-1234',
  };
  const response = http.post(FORGOT_USER_URL, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'FORGOT_USER_OTP' },
  });
  return { response, payload };
}
