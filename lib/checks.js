import { check } from 'k6';

export function checkStatus200(res) {
  return check(res, {
    'status is 200': (r) => r.status === 200,
  });
}

export function checkHasJsonField(res, field) {
  return check(res, {
    [`has ${field}`]: (r) => {
      try {
        return !!r.json(field);
      } catch {
        return false;
      }
    },
  });
}
