# OAuth Scope Justification — Company List Cleaner for Google Sheets

OAuth審査（sensitive scope verification）フォームへコピペする英文。各スコープ約100語。
根拠: requirements.md CR-3/CR-5/CR-7・N-3、handover.md §5/§6。**この3スコープ以外は申請しない（CR-7）**。

---

## 1. `https://www.googleapis.com/auth/spreadsheets.currentonly`

> Company List Cleaner is an editor add-on that cleans customer/vendor lists inside the spreadsheet the user has open. This scope is required to (1) read only the columns the user explicitly designates in the sidebar (company name, corporate number, invoice registration number) and (2) write results as newly appended columns plus a per-row status column, never overwriting existing cells. We chose `spreadsheets.currentonly` instead of the broader `spreadsheets` scope deliberately: the add-on must never access any spreadsheet other than the one it is running in. No spreadsheet content is stored on our servers; retrieved public-registry data is written only to the user's sheet.

## 2. `https://www.googleapis.com/auth/script.external_request`

> This scope is required to call our own backend over HTTPS (`UrlFetchApp`), which proxies three official Japanese government data sources: the National Tax Agency Corporate Number Web-API, the NTA Qualified Invoice Issuer Publication Web-API, and METI gBizINFO. The backend enforces serial, rate-limited access (1 request/second) as declared to the NTA. Only the values of user-designated columns are transmitted — never other sheet content. Retrieved publication data is returned to the sheet and is not stored, cached, or logged server-side; access logs contain only a pseudonymous user key, timestamp, and queried registration number. The manifest's `urlFetchWhitelist` restricts requests to our backend domain only.

## 3. `https://www.googleapis.com/auth/script.container.ui`

> This scope is required to display the add-on's sidebar (`HtmlService`), which is the entire user interface: column mapping with header auto-detection, options for which data to append, a progress bar with cancel/retry for batch processing, monthly free-quota display, license key entry, and an always-available help section containing usage limits and the source attributions required by the National Tax Agency and METI. The sidebar itself accesses no user data; it only invokes the server functions covered by the two scopes above. Without this scope the add-on has no way to present its UI inside Google Sheets.

---

## 補足（フォームの追加設問で使う想定問答・英語）

- **Why not narrower scopes?** These are already the narrowest scopes available for each capability: `spreadsheets.currentonly` (not `spreadsheets`), a single whitelisted external host, and container-bound UI only. We use no restricted scopes (no Gmail/Drive access).
- **Data retention:** Public-registry responses are never persisted server-side (a condition of our NTA Web-API application). The only stored data are a monthly usage counter (row count keyed by a pseudonymous UUID) and Stripe billing references. Access logs are limited to three fields: user key, timestamp, queried registration number.
- **Data sharing:** No data is shared with third parties. External calls go only to Japanese government open-data APIs via our backend, and to Stripe for payment processing.
