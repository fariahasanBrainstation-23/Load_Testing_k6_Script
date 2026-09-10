export function createTokenLogger() {
  function logToken({ sid, token, status, errorMessage }) {
    const entry = {
      SID: sid || '',
      Token: token || '',
      Status: status || '',
      ErrorMessage: errorMessage || '',
    };
    console.log(`TOKEN_LOG_JSON:${JSON.stringify(entry)}`);
  }

  return { logToken };
}
