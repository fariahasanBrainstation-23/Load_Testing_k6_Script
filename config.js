export const BASE_URL = __ENV.BASE_URL || 'https://uat-bss.race.net.bd';
export const SELFCARE_BASE_URL = __ENV.SELFCARE_BASE_URL || 'https://uat-myorbit.race.net.bd';

const thresholds = {
  http_req_duration: ['p(95)<1000'],
  http_req_failed: ['rate<0.01'],
};

export const defaultOptions = {
  vus: Number(__ENV.VUS) || 10,
  duration: __ENV.DURATION || '30s',
  thresholds,
};
