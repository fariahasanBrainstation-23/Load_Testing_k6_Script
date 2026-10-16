import http from 'k6/http';
import { BASE_URL } from '../../config.js';

const BULK_OPERATION_URL = `${BASE_URL}/myrace-master-billing/api/v1/billing/bulk-operation`;

function jsonHeaders(authHeaders) {
  return { ...authHeaders, 'Content-Type': 'application/json' };
}

// Step 1: select the SIDs and get back a sessionId. Body shape matches the captured HAR
// (isp is the string "true" there, and allSID is false because SIDs are listed explicitly).
export function createFilterSession(authHeaders, opts) {
  const payload = {
    entityEid: opts.entityEid,
    isp: opts.isp,
    billingType: opts.billingType,
    allSID: false,
    sids: opts.sids,
    totalCount: opts.sids.length,
    operationType: 'MAC_REMOVE',
    customerFilter: {
      billingType: opts.billingType,
      isp: opts.isp,
      entityEid: opts.entityEid,
      entityFilterType: opts.entityFilterType,
    },
  };
  const response = http.post(`${BULK_OPERATION_URL}/customers/filter-session`, JSON.stringify(payload), {
    headers: jsonHeaders(authHeaders),
    tags: { name: 'MAC_REMOVE_FILTER_SESSION' },
  });
  return { response, payload };
}

// Step 2: run the operation for that session. Returns immediately with a bulkJobId; the work happens asynchronously.
export function executeMacRemove(authHeaders, sessionId) {
  const payload = { sessionId, params: { operationType: 'MAC_REMOVE', sessionId } };
  const response = http.post(`${BULK_OPERATION_URL}/execute`, JSON.stringify(payload), {
    headers: jsonHeaders(authHeaders),
    tags: { name: 'MAC_REMOVE_EXECUTE' },
  });
  return { response, payload };
}

// Step 3: the jobs list (newest first). The UI uses pageSize=10; a larger page makes sure our job is still on the
// first page when many jobs are created at once.
export function getBulkJobs(authHeaders, pageSize = 10) {
  const url = `${BULK_OPERATION_URL}/jobs?pageNumber=0&pageSize=${pageSize}&sortBy=${encodeURIComponent('id;DESC')}`;
  return http.get(url, { headers: authHeaders, tags: { name: 'MAC_REMOVE_JOB_STATUS' } });
}
