# k6 Load Testing Project — Conventions

## Structure

```
config.js              # shared config: BASE_URL, common thresholds, default options
lib/
  auth.js              # login/token helpers reused across scripts
  checks.js            # shared check() functions (status 200, response time, etc.)
data/
  users.json           # test user credentials / payloads (never real prod secrets)
  <feature>.json        # per-feature test data
<feature>_test.js       # one file per feature/flow (login_test.js, checkout_test.js, ...)
```

## Rules

- **One file per feature/flow.** Don't combine unrelated flows (login, checkout, search) into one script.
- **No hardcoded environment values.** Use `__ENV.BASE_URL`, `__ENV.USERNAME`, `__ENV.PASSWORD`, etc. Run via:
  `k6 run -e BASE_URL=https://uat-bss.race.net.bd -e USERNAME=vikram -e PASSWORD=xxx login_test.js`
- **No real credentials/secrets committed.** Use env vars or a gitignored `.env` + loader. Use test/UAT accounts only, never prod.
- **Shared config import.** Pull BASE_URL and default `options` (thresholds, stages) from `config.js` instead of redefining per file.
- **Reusable checks.** Common checks (status 200, has token, response time < X) live in `lib/checks.js`, imported not duplicated.
- **Data-driven tests.** Multi-user/payload tests load from `data/*.json` via `SharedArray`, not inline arrays in the test file.
- **Consistent thresholds.** Every script sets `http_req_duration` and `http_req_failed` thresholds unless there's a specific reason not to.
- **HAR-derived scripts.** When building a script from a HAR file, extract only the feature-relevant request(s) — strip tracking/analytics/static asset calls.
- **Naming.** File and function names describe the feature/flow (`login_test.js`, `checkoutFlow()`), not generic names like `test1.js`.

## When asked to add a new script

1. Check if `config.js` / `lib/` already exist — reuse, don't duplicate.
2. Extract endpoint(s) from HAR/DevTools capture for that feature only.
3. Follow the file structure above.
4. Add thresholds consistent with existing scripts.
5. Flag any hardcoded secrets found in HAR before committing them to the script.
