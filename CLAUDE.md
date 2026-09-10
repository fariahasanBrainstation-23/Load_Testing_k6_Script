# k6 Load Testing Project — Conventions

## Structure

```
config.js              # shared config: BASE_URL, SELFCARE_BASE_URL, common thresholds, default options
lib/
  auth.js              # login/token helpers reused across scripts
  checks.js            # shared check() functions (status 200, response time, etc.)
data/
  users.json           # test user credentials / payloads (never real prod secrets)
  <feature>.json        # per-feature test data
<feature>_test.js       # one file per feature/flow (login_test.js, checkout_test.js, ...)
```

### Self-care (myorbit) flows

Customer-facing self-care APIs live on a separate host (`SELFCARE_BASE_URL`, `uat-myorbit.race.net.bd`) from the admin/agent BSS APIs (`BASE_URL`, `uat-bss.race.net.bd`). All self-care scripts, lib helpers, and data files live under `selfcare/`, kept separate from the admin ones above — only `config.js` and `lib/checks.js` are shared (imported via `../`).

```
selfcare/
  lib/
    auth.js              # selfCareLogin() — myorbit customer login (separate from admin login() in root lib/auth.js)
    onlineRecharge.js     # self-care API helpers, one function per endpoint (initiateOnlineRecharge, ...)
    csv.js                # parseCsv() — generic CSV loader (SharedArray-friendly)
    tokenLogger.js         # createTokenLogger() — emits TOKEN_LOG_JSON console lines for SID/token extraction
  data/
    LoginCustomer.csv     # SID,Password — customer credentials, edit directly to add more accounts
    CustomerIdToken.csv   # SID,Token — access tokens extracted from a login run, reused by other self-care tests
  selfcare_login_test.js  # logs in as every SID in data/LoginCustomer.csv once, prints TOKEN_LOG_JSON per SID
  online_recharge_test.js # load test using stored tokens from data/CustomerIdToken.csv (no login per iteration)
  generate-token-excel.js # node script: parses TOKEN_LOG_JSON lines from a k6 run log -> reports/*.xlsx (SID, Token, Status, ErrorMessage)
```

**Token workflow:** `npm.cmd run selfcare-tokens` (or `npm run selfcare-tokens` if your shell allows npm scripts) runs `selfcare/selfcare_login_test.js`, captures its output to `reports/selfcare-run.log`, and generates `reports/selfcare-tokens.xlsx` regardless of threshold pass/fail. Copy fresh tokens from there into `selfcare/data/CustomerIdToken.csv` when the old ones expire (JWTs carry an `exp` claim — re-run this when self-care tests start failing with 401s).

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
