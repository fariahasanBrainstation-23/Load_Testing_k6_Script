import http from 'k6/http';
import { BASE_URL } from '../config.js';

export function uploadFile(authHeaders, fileBinary, fileName) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/file/save/public`;
  const payload = {
    file: http.file(fileBinary, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  };

  return http.post(url, payload, { headers: authHeaders });
}

export function triggerBulkUpload(authHeaders, filePath, code) {
  const url = `${BASE_URL}/myrace-master-billing/api/v1/billing/bulk-upload`;
  const payload = JSON.stringify({
    file: filePath,
    code,
    instance: true,
  });

  const headers = { ...authHeaders, 'Content-Type': 'application/json' };
  return http.post(url, payload, { headers });
}
