function stringifyValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function createRequestLogger(scriptName) {
  const logs = [];

  function logRequest({ apiName, requestMethod, url, statusCode, errorMessage, responseTime, responseBody }) {
    const entry = {
      Timestamp: new Date().toISOString(),
      ScriptName: scriptName || '',
      VUNumber: typeof __VU !== 'undefined' ? __VU : null,
      IterationNumber: typeof __ITER !== 'undefined' ? __ITER : null,
      APIName: apiName || '',
      RequestMethod: requestMethod || '',
      URL: url || '',
      StatusCode: statusCode || null,
      ErrorMessage: errorMessage || '',
      ResponseTime: responseTime || null,
      ResponseBody: stringifyValue(responseBody),
    };
    logs.push(entry);
    console.log(`REQ_LOG_JSON:${JSON.stringify(entry)}`);
  }

  function getLogs() {
    return logs;
  }

  return { logRequest, getLogs };
}
