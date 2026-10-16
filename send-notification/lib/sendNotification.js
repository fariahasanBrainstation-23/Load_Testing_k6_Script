import http from 'k6/http';
import { BASE_URL } from '../../config.js';

// POST /billing/bulk-send-notification. Body shape matches the captured HAR exactly (email/bell left disabled --
// this script only tests the SMS path). Returns 200 with an empty body on success (accepted, not confirmed sent --
// same async pattern as bulk-upload/MAC remove: check the bulk-send-notification history list for the real outcome).
export function sendBulkNotification(authHeaders, { title, templateId, sendingAudience, sendSubAudience, sids }) {
  const payload = {
    title,
    description: '',
    sendInstant: true,
    sms: { enabled: true, templateId },
    email: { enabled: false, templateId: null },
    bell: { enabled: false, templateId: null, platform: 'WEB' },
    sendingAudience,
    sendSubAudience,
    audience: { fixed: true, codes: sids, query: {}, excludeItem: [] },
    status: 'INITIAL',
  };
  const response = http.post(`${BASE_URL}/myrace-master-billing/api/v1/billing/bulk-send-notification`, JSON.stringify(payload), {
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
  });
  return { response, payload };
}
