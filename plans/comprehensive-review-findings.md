# Comprehensive Code Review — Findings List

Scope: every first-party runtime file in the repository (UI, Worker backend, D1 data
layer, shared libraries, build/CI configuration) plus the UI↔Worker API boundary.

Method: full-file reads (no sampling) of all tracked source files, cross-checked
against callers/callees, D1 SQL, and the repository's own tests. Each candidate was
traced from entry point to state change and actively disproved where a guard already
existed.

Excluded by design: third-party/generated code (`worker-configuration.d.ts`,
`package-lock.json`), and findings disproved by an existing guard. Two candidates
raised during triage were **discarded as false positives** — see "Discarded" below.

Status column values: `FIXED` (implemented and verified by a behavioral test unless the fix is itself a static/build contract), `OPEN` (not yet addressed), `ACCEPTED RISK` (a known, deliberately retained risk with its rationale and mitigation recorded).

---

## Summary

| ID | Severity | Confidence | Area | Title | Status |
|----|----------|-----------|------|-------|--------|
| R1  | Critical | High | UI hook | `useSimulation` empty-basket branch self-retriggers an unbounded render loop | FIXED |
| R2  | High     | High | Infra   | `asset-error-recovery.js` reloads forever when `sessionStorage` is unavailable | FIXED |
| R3  | High     | High | UI hook | `useSimulation` stale response overwrites the current basket's data | FIXED |
| R4  | Medium   | High | UI hook | `useIndices` persists the ETag before the body is validated → permanent stale 304 | FIXED |
| R5  | Medium   | High | UI hook | `useIndices` casts unvalidated `localStorage` JSON to `CustomIndex[]` → crash | FIXED |
| R6  | Medium   | High | UI hook | `useAuth.logout()` does not cancel an in-flight login; `loading` is not per-request | FIXED |
| R7  | Medium   | High | UI hook | `useSimulation` storage access is not exception-safe (`typeof localStorage` throws) | FIXED |
| R8  | Medium   | High | UI hook | `useBenchmark` writes the session cache before the abort guard | FIXED |
| R9  | Medium   | High | Data layer | `fetchStockFundamentals` spreads an unvalidated API payload over the typed model | FIXED |
| R10 | Medium   | High | Data layer | Client fundamentals / screener caches have no TTL → stale for the whole session | FIXED |
| R11 | Medium   | High | UI state | `FreshnessContext` seeds "latest updated" with `Date.now()` → fake LIVE badge | FIXED |
| R12 | Medium   | High | UI state | `PortfolioManagerPage` mutates refs and calls `setState` during render | FIXED |
| R13 | Medium   | High | UI hook | `StockTechnicalChart` depends on the whole `stock` object → duplicate write requests | FIXED |
| R14 | Medium   | High | DB layer | `rate_limits` has no index for the `window_start` purge the Worker runs | FIXED |
| R15 | Medium   | High | Data layer | `getStoredAuth()` parses `sessionStorage` without runtime validation | FIXED |
| R16 | Medium   | High | UI hook | `useIndices` never aborts its in-flight request on unmount | FIXED |
| R17 | Medium   | High | Tooling  | Test files are excluded from every typecheck; vitest never type-checks | FIXED |
| R18 | Medium   | High | Data layer | Portfolio/watchlist auto-save overwrites other tabs' data; no `storage` sync | FIXED |
| R19 | Low      | High | Data layer | `useSimulation`/`useCalculation` race on the shared sync-cache `localStorage` key | FIXED |
| R20 | Low      | High | Data layer | `sanitizePosition` fallback id is not unique → duplicate keys, delete removes both | FIXED |
| R21 | Low      | High | Data layer | `allocateIntegerWeights` breaks its documented "sum is exactly total" invariant | FIXED |
| R22 | Low      | High | Data layer | A non-numeric calendar cache timestamp disables the TTL entirely | FIXED |
| R23 | Low      | High | Data layer | CSV round-trip silently strips a legitimate leading apostrophe | FIXED |
| R24 | Low      | High | Data layer | `deserializeIndexFromJson` never validates the exported schema `version` | FIXED |
| R25 | Low      | Medium | Data layer | FX fallback sparkline is rounded to 2 decimals (collapses sub-2 quotes) | FIXED |
| R26 | Low      | High | DB layer | `snapshot_cache` schema differs between `schema.sql` and runtime provisioning | FIXED |
| R27 | Low      | High | Infra   | CI workflow has no `concurrency` group | FIXED |
| R28 | Low      | Medium | Infra   | `wrangler.jsonc` `observability.enabled:false` contradicts `logs.enabled:true` | FIXED |
| R29 | Low      | High | UI hook | `useModalFocus` writes a ref during render | FIXED |
| R30 | Low      | High | UI comp | `TradingViewChartModal` leaves timers and a RAF running after unmount | FIXED |
| R31 | Low      | Medium | UI comp | Lockout countdown recreates its interval every second | FIXED |
| R32 | Low      | Medium | UI comp | `IndexBuilderContent` writes a ref during render | FIXED |
| R33 | Low      | Medium | UI hook | `useSimulation` swallows every sync error and blocks the preview on it | FIXED |
| R34 | Low      | High | UI hook | `syncedTickersRef` map is never pruned | FIXED |
| R35 | Low      | High | Data layer | `macro-jp-cpi` calendar event duplicates `MACRO_METRICS_DEFAULTS.jpCpi` | FIXED |
| R36 | Low      | Medium | UI comp | Orphan radio-group label; duplicate `aria-label` navigation landmarks | FIXED |
| R37 | Medium   | High | Data layer | `redistributeWeightsExact` can emit a zero weight -> the Worker rejects the basket | FIXED |
| R38 | Medium   | High | Tooling  | 34 hidden type errors in the test suite (stale fixtures, broken import, dead directive) | FIXED |
| R39 | Medium   | High | Test quality | A contribution-normalization test was vacuous (the fixture had no price series) | FIXED |
| R40 | Low      | High | Test quality | The iCalendar assertion did not match the importance prefix the export produces | FIXED |
| R41 | Low      | High | Data layer | The portfolio-to-basket weight sum is `max(constituents, 100)`, not always 100 | FIXED |
| R42 | Critical | High | UI hook | The auth request identity was per hook instance, so a logout did not cancel another instance's login | FIXED |
| R43 | Medium   | High | Data layer | The fundamentals sanitizer dropped the PER disclosure (`isEstimatedPer` / `perNote`) | FIXED |
| R44 | Medium   | High | UI comp | The chart marked the preflight write as done before it succeeded, so a failure was never retried | FIXED |
| R45 | Medium   | High | UI comp | A superseded authentication was reported as a failed login and reset the Turnstile token | FIXED |
| R46 | Low      | High | UI hook | The simulation error path ignored the request identity; stale sync warnings survived a local recompute | FIXED |
| R47 | Low      | High | Process | The findings list had been written twice end to end | FIXED |
| R48 | Low      | High | Test quality | The sync-cache key test asserted a local copy of the read-modify-write instead of the production module | FIXED |
| R49 | Medium   | High | Data layer | The portfolio add path still minted ids from `Date.now()` while the factory existed | FIXED |
| R50 | Medium   | High | Test quality | R29–R32 and R36 were "verified" only by source-text assertions | FIXED |
| R51 | High     | High | Security | The plaintext password is replayed on every request and logout cannot revoke it | ACCEPTED RISK |
| R52 | Low      | High | Security | Custom-index owner tokens never expire or rotate | OPEN |
| R53 | Low      | High | Test quality | 85 of 191 test files still assert on source text | OPEN |
| P1  | High     | High | Performance | 397 KiB gzip is modulepreloaded on first paint, including the 4,805-line stock dataset | OPEN |
| P2  | Medium   | High | Performance | `recharts` (112.8 KiB gzip) is preloaded before any chart is requested | OPEN |

---

## Findings

### R1 — Critical / High confidence / UI hook

- **Location:** `src/hooks/useSimulation.ts` — effect "clear" branch and the effect's dependency list.
- **Trace:** `IndexBuilderContent.tsx:229` `useSimulation(basket, baseValue)` → effect →
  `decideSimulationEffectAction` returns `"clear"` when `basket.length === 0` →
  `setCustomSeries([])` / `setStockUniverse([])`.
- **Actual Behavior:** each run writes a *fresh* array literal into `stockUniverse`,
  which is an effect dependency. The write always changes identity, so React
  re-renders, the effect re-runs, and the cycle repeats until React aborts with
  "Maximum update depth exceeded".
- **Expected Behavior:** clearing an already-empty simulation must not schedule work.
- **Conditions / Trigger:** `IndexBuilderContent.handleRemoveStock` (line 312) removes
  the last constituent with no guard, so an empty basket is reachable from the UI.
- **Existing Mitigations Checked:** the "recompute" branch was already hardened for the
  same class of bug (see the comment at the original line 359); the "clear" branch was not.
- **Root Cause:** the effect writes state unconditionally instead of writing it
  *idempotently*. React only skips a re-render when a state updater returns the
  previous reference.
- **Fix Direction:** use functional updaters that return the previous reference when
  the collection is already empty; extract the transition into a pure, testable helper.
- **Verification Plan:** unit-test the extracted transition for reference identity
  (the exact mechanism React relies on) plus a regression test on the action decision.

### R2 — High / High confidence / Infrastructure

- **Location:** `public/asset-error-recovery.js:16-26`.
- **Actual Behavior:** when `sessionStorage` access throws (blocked storage), the
  `catch` sets `alreadyRetried = false`, which is the "not yet retried" signal, so the
  script schedules `window.location.reload()`. The retry flag could not be persisted,
  so the next load repeats the same path — an unbounded ~1 s reload loop that never
  reaches the error panel the script exists to render.
- **Expected Behavior:** when the retry flag cannot be persisted, treat the retry as
  already consumed and render the error panel.
- **Root Cause:** "flag absent" and "flag unreadable" were conflated into one boolean.
- **Fix Direction:** distinguish *read failure* from *not-yet-retried*; only reload when
  the flag was successfully persisted as absent.
- **Verification Plan:** execute the script's decision logic under a storage that
  throws and assert that no reload is scheduled and the panel path is taken.

### R3 — High / High confidence / UI hook

- **Location:** `src/hooks/useSimulation.ts` — `/api/calculate` response handling and
  the effect's "clear"/"recompute" branches.
- **Actual Behavior:** there is no abort check after `await calcRes.json()`, and the
  "clear"/"recompute" branches never abort the in-flight request. A response for an
  older basket therefore lands after the basket changed and overwrites
  `stockUniverse`/`customSeries`, and `knownTickersRef.current` receives a stale
  closure-captured key.
- **Expected Behavior:** a superseded response must never be applied.
- **Root Cause:** request validity was tracked only by the `AbortController`, but the
  branches that supersede a request did not abort it, and the response handler did not
  re-check the signal after the awaited body read.
- **Fix Direction:** abort the in-flight request whenever the effect takes a
  non-fetching branch, and re-check `controller.signal.aborted` after parsing the body.
- **Verification Plan:** regression test that a superseded/aborted run cannot commit
  state, plus a test asserting the abort is issued on clear.

### R4 — Medium / High confidence / UI hook

- **Location:** `src/hooks/useIndices.ts` — `fetchIndices`.
- **Actual Behavior:** the response ETag is written to `localStorage` *before*
  `res.json()` is awaited and *before* the `isCurrentRequest()` generation check. If
  the body fails to parse, the new ETag is already paired with the old body, so the
  next request legitimately receives `304` and the UI silently keeps the stale list
  with the error cleared. An out-of-order response pair can also overwrite the newer
  ETag.
- **Expected Behavior:** the ETag and the body must be committed together, and only by
  the request that is still current.
- **Root Cause:** the conditional-request cache was written in two independent,
  non-atomic steps, and the write was not covered by the existing generation guard.
- **Fix Direction:** validate the body first, then commit body + ETag together under
  the generation guard.
- **Verification Plan:** test that a body-parse failure leaves the stored ETag
  untouched, and that a superseded response does not overwrite the stored ETag.

### R5 — Medium / High confidence / UI hook

- **Location:** `src/hooks/useIndices.ts` — `getLocalIndicesCache`.
- **Actual Behavior:** `JSON.parse` output is returned as `CustomIndex[]` with no
  per-field validation. A corrupt/hand-edited cache becomes `selectedIndex`, and
  consumers dereference `selectedIndex.basket.length` / `.basket.map(...)`, throwing
  during render and taking the dashboard down.
- **Expected Behavior:** persisted data must be validated field-by-field before it is
  typed as `CustomIndex`.
- **Root Cause:** an unchecked cast was used where every other persisted read in the
  codebase (`parseLocalSyncCache`, `ownership.getStore`, `sanitizePosition`) validates.
- **Fix Direction:** a per-index validator; drop invalid entries and fall back to the
  built-in defaults.
- **Verification Plan:** test corrupt cache payloads (missing `basket`, wrong types,
  `null` elements) and assert the hook falls back instead of crashing.

### R6 — Medium / High confidence / UI hook

- **Location:** `src/hooks/useAuth.ts` — `login`, `handleAdminLogin`, `logout`.
- **Actual Behavior:** `logout()` does not cancel an in-flight login, so the pending
  response calls `setSession(res.session)` afterwards and silently re-authenticates the
  user (and re-persists the session). `loading` is a single boolean shared by all
  concurrent attempts, so the first request to settle clears the spinner while another
  is still pending.
- **Expected Behavior:** logging out must win over an in-flight login, and the busy
  state must reflect the outstanding requests.
- **Root Cause:** the hook had no request identity at all.
- **Fix Direction:** add a request generation counter plus an `AbortController`;
  ignore results from superseded attempts and only clear `loading` for the current one.
  The identity has to be shared by every `useAuth()` consumer — see R42 for the
  per-instance variant that a first fix introduced.
- **Verification Plan:** test that a login resolving after a logout is discarded and
  that `loading` stays true while any attempt is outstanding.

### R7 — Medium / High confidence / UI hook

- **Location:** `src/hooks/useSimulation.ts` — `localStorage` read/write.
- **Actual Behavior:** `typeof localStorage === "undefined"` itself evaluates the
  `window.localStorage` getter, which throws `SecurityError` when storage is blocked;
  the access is also outside any `try`. The exception escapes to the outer catch and
  is misreported as "server unreachable", showing demo data.
- **Expected Behavior:** blocked storage must not be reported as a network failure.
- **Root Cause:** the storage access was written inline instead of through the
  exception-safe helper that `useCalculation` already uses.
- **Fix Direction:** route every storage access through a single exception-safe
  helper shared by both hooks.
- **Verification Plan:** test the helper with a throwing storage and assert it yields
  an empty cache instead of propagating.

### R8 — Medium / High confidence / UI hook

- **Location:** `src/hooks/useBenchmark.ts` — module cache write in the fetch chain.
- **Actual Behavior:** `benchmarkSessionCache.set(...)` runs before the
  `controller.signal.aborted` check, so a superseded response can overwrite a newer
  cache entry *and* stamp it with `Date.now()`, making the stale payload live for the
  full 5-minute TTL.
- **Expected Behavior:** an aborted request must not publish to the session cache.
- **Root Cause:** the abort guard was applied to React state but not to the cache write
  that feeds the next render.
- **Fix Direction:** guard the cache write with the same abort check.
- **Verification Plan:** test that an aborted fetch leaves the cache untouched.

### R9 — Medium / High confidence / Data layer

- **Location:** `src/lib/marketDataService.ts` — `fetchStockFundamentals`.
- **Actual Behavior:** only `ticker` and `price` are validated; the whole raw payload
  is then spread over the typed model (`...rawObj`) and `sparkline` is asserted with
  `as number[]`. A non-numeric `change`/`changePercent`/`dps` or a `null` inside
  `sparkline` reaches the UI, producing `NaN` daily P&L in the portfolio (whose total
  silently coerces to 0) and a broken technical signal.
- **Expected Behavior:** every numeric field must be validated before it is stored in a
  `number`-typed model.
- **Root Cause:** the response was trusted because the model type asserted it, and the
  `as number[]` assertion hid the unchecked cast from the compiler.
- **Fix Direction:** a runtime sanitizer that accepts only finite numbers and falls
  back to the baseline per field.
- **Verification Plan:** feed hostile payloads (string numbers, `null`, `NaN`) and
  assert the sanitized model contains only finite numbers.

### R10 — Medium / High confidence / Data layer

- **Location:** `src/lib/marketDataService.ts` — `stockFundamentalsClientCache` and
  `screenerUniverseClientCache`.
- **Actual Behavior:** the success caches have no expiry (the *failure* cache does have
  a 30 s cooldown), so a quote fetched at 09:05 is still served at 14:00 while the UI
  refreshes the "last updated" timestamp to now and presents it as live.
- **Expected Behavior:** a client cache entry must not outlive its usefulness.
- **Root Cause:** the cache stored values without a timestamp, so no TTL could be
  applied.
- **Fix Direction:** store a timestamp with each entry and expire it.
- **Verification Plan:** test that an entry older than the TTL is re-fetched.

### R11 — Medium / High confidence / UI state

- **Location:** `src/contexts/FreshnessContext.tsx`.
- **Actual Behavior:** `globalLatestUpdatedAt` is seeded with `Date.now()` and only
  ever increases, so it is never `null` and never moves backwards. Views that register
  no timestamp of their own therefore report the app's load time as "last updated" and
  render the LIVE badge for data that was never fetched.
- **Expected Behavior:** "no data yet" must be distinguishable from "updated at T".
- **Root Cause:** a *fallback* value was seeded with the current time, conflating
  "unknown" with "just now".
- **Fix Direction:** start as `null`; only populate from a real observation, and keep
  the monotonic maximum over real observations only.
- **Verification Plan:** test that the resolved timestamp is `null` before any data is
  registered.

### R12 — Medium / High confidence / UI state

- **Location:** `src/components/PortfolioManagerPage.tsx` — the auth-transition block.
- **Actual Behavior:** `prevAuthRef.current` is mutated and `setPositions`/`setWatchlist`
  are called *during render*. A discarded render leaves the ref already flipped while
  the queued state update was never committed, so the portfolio stays empty and the
  "sample portfolio" banner is suppressed — with no error shown.
- **Expected Behavior:** render must be side-effect free.
- **Root Cause:** an auth transition was handled imperatively during render instead of
  in an effect.
- **Fix Direction:** move the transition into an effect keyed on `isAuthenticated`.
- **Verification Plan:** regression test that the transition logic is applied exactly
  once per auth change.

### R13 — Medium / High confidence / UI hook

- **Location:** `src/components/StockTechnicalChart.tsx` — the history-fetch effect.
- **Actual Behavior:** the effect depends on the whole `stock` object, but
  `StockDetailPage` replaces that object on every quote refresh. Each refresh
  therefore re-runs the effect and issues another `POST /api/sync-prices` — a *write*
  endpoint that fetches from Yahoo and writes D1 — even though the historical series
  cannot have changed.
- **Expected Behavior:** the effect must depend on the values it actually reads.
- **Root Cause:** an object was used as the dependency instead of the primitive fields
  it reads.
- **Fix Direction:** derive a content signature from the fields the chart consumes
  and skip the whole effect when neither the signature nor the retry counter
  changed; the D1 write is additionally issued only when the ticker changed.
  A failed write must stay unmarked so the next run retries it (R44).
- **Verification Plan:** test that changing only a quote field does not re-trigger the
  history fetch, and that a failed preflight write is retried.

### R14 — Medium / High confidence / DB layer

- **Location:** `schema.sql` — `rate_limits`; `worker/internal-impl.ts` — the purge.
- **Actual Behavior:** the Worker runs
  `DELETE FROM rate_limits WHERE window_start < ?` but `window_start` is unindexed, so
  the purge is a full table scan over a table that grows with the number of distinct
  client IPs, on a write-quota-limited D1 database.
- **Expected Behavior:** the purge must use an index.
- **Root Cause:** the schema only covers the primary key.
- **Fix Direction:** add `idx_rate_limits_window_start` in both `schema.sql` and the
  runtime provisioner so the two paths stay equivalent.
- **Verification Plan:** assert the index exists in `schema.sql` and that the runtime
  provisioner creates the same index.

### R15 — Medium / High confidence / Data layer

- **Location:** `src/lib/auth.ts` — `getStoredAuth`.
- **Actual Behavior:** `JSON.parse(raw) as AuthSession` performs no shape check, so a
  corrupt or foreign session payload is returned as a typed session — e.g.
  `{"role":"admin"}` makes the UI render the admin surface and sends `x-admin-key` on
  every request, which the Worker rejects with 401.
- **Expected Behavior:** persisted session data must be validated before it is used.
- **Root Cause:** the only "validation" was a type assertion.
- **Fix Direction:** a `sanitizeAuthSession` validator (role must be `admin`/`user`,
  password must be a non-empty string, limits must be finite numbers or `null`).
- **Verification Plan:** test malformed payloads and assert `null` is returned.

### R16 — Medium / High confidence / UI hook

- **Location:** `src/hooks/useIndices.ts` — `fetchIndices`.
- **Actual Behavior:** the request is only aborted by the 10 s timeout; there is no
  unmount cleanup, so the request continues and calls `setIndices`/`setSelectedIndex`/
  `setError` on an unmounted hook. The three sibling hooks do abort on unmount.
- **Expected Behavior:** requests must be cancelled when the consumer goes away.
- **Root Cause:** the controller was created inside the callback and never owned by the
  hook lifecycle.
- **Fix Direction:** hold the controller in a ref owned by the hook and abort it in the
  unmount effect.
- **Verification Plan:** test that unmounting aborts the in-flight request.

### R17 — Medium / High confidence / Tooling

- **Location:** `tsconfig.app.json`, `tsconfig.worker.json`, `vite.config.ts`.
- **Actual Behavior:** every `*.test.ts` is excluded from both typecheck projects and
  vitest is configured without `typecheck`, so a type error inside a test is never
  detected by `lint`, `test` or `build` and ships unnoticed.
- **Expected Behavior:** test code should be type-checked like production code.
- **Root Cause:** the application tsconfig is configured for the browser bundle only
  (`types: ["vite/client"]`), which cannot express the Node/Worker globals the tests
  legitimately use, so the tests were excluded rather than given their own project.
- **Fix Direction:** a dedicated `tsconfig.test.json` that includes the test files with
  the Node and Worker ambient types, wired into the build script; fix the resulting
  type errors properly.
- **Verification Plan:** the new project must type-check cleanly and be part of
  `npm run build`.

### R18 — Medium / High confidence / Data layer

- **Location:** `src/lib/portfolioStorage.ts`, `src/components/PortfolioManagerPage.tsx`.
- **Actual Behavior:** the page re-serializes its *entire* in-memory array on every
  change, and no `storage` event listener exists. A second tab that adds a position
  has its entry silently deleted when the first tab next writes its stale array.
- **Expected Behavior:** a tab must not destroy another tab's writes.
- **Root Cause:** the persisted array is treated as a private snapshot rather than
  shared state.
- **Fix Direction:** subscribe to the `storage` event and reload the persisted list
  when another tab changes it.
- **Verification Plan:** test the subscription/reload path.

### R19 — Low / High confidence / Data layer

- **Location:** `src/hooks/useSimulation.ts`, `src/hooks/useCalculation.ts`.
- **Actual Behavior:** both hooks parse the whole `osi_stock_sync_cache` object,
  mutate a subset, and write the whole object back. Whichever writes last drops the
  other's entries, so the "already synced" decision diverges between the dashboard and
  the builder and extra `/api/sync-prices` traffic is generated.
- **Expected Behavior:** one owner for the shared cache.
- **Root Cause:** the cache is a shared key with two independent read-modify-write
  owners.
- **Fix Direction:** move the cache into a single module that both hooks use, with a
  single read-modify-write implementation.
- **Verification Plan:** test the shared module's merge behaviour.

### R20 — Low / High confidence / Data layer

- **Location:** `src/lib/portfolioStorage.ts` — `sanitizePosition`.
- **Actual Behavior:** the fallback id is `pos-${ticker}-${shares}`, so two lots of the
  same ticker with the same share count collapse to one id → duplicate React keys and
  a delete that removes both lots.
- **Expected Behavior:** persisted positions must have unique ids.
- **Root Cause:** the fallback id was derived from non-unique fields.
- **Fix Direction:** derive a unique id (counter/timestamp/uuid suffix).
- **Verification Plan:** test that two identical lots receive distinct ids.

### R21 — Low / High confidence / Data layer

- **Location:** `src/lib/weights.ts` — `allocateIntegerWeights`.
- **Actual Behavior:** `safeTotal = Math.max(n, total)` silently raises the target above
  `total`, so with more entries than units the returned weights sum to `n`, not
  `total`; the documented invariant ("sum is exactly `total`") is false, and the
  wrap-around loop that was meant to handle this is unreachable dead code.
- **Expected Behavior:** the documented contract must hold, or the contract must state
  the exception precisely.
- **Root Cause:** the min-1-unit invariant and the exact-total invariant conflict when
  `n > total`, and the clamp was applied without updating the contract.
- **Fix Direction:** make the two invariants consistent — the sum must equal the
  effective total, and the effective total must be documented.
- **Verification Plan:** test the sum for `n > total`, `n === total` and `n < total`.

### R22 — Low / High confidence / Data layer

- **Location:** `src/lib/marketDataService.ts` — `loadCalendarCache`.
- **Actual Behavior:** `parsed.timestamp` is cast to `number` without validation; a
  string timestamp makes `Date.now() - timestamp` produce `NaN`, and `NaN > TTL` is
  `false`, so the TTL branch is skipped and the entry is treated as fresh forever.
- **Expected Behavior:** an unreadable timestamp must not extend the cache lifetime.
- **Root Cause:** the cast replaced a validation.
- **Fix Direction:** validate the timestamp and treat an invalid one as expired.
- **Verification Plan:** test a non-numeric timestamp and assert the entry is dropped.

### R23 — Low / High confidence / Data layer

- **Location:** `src/lib/csv.ts` — `escapeCsvCell` / `cleanParsedCell`.
- **Actual Behavior:** the writer prefixes `'` only when the value *starts* with a
  formula character, but the reader strips `'` whenever it is *followed* by one. A
  legitimate value such as `'-review` is exported unchanged and comes back as
  `-review` — the apostrophe is destroyed.
- **Expected Behavior:** the writer and reader must be exact inverses.
- **Root Cause:** the two guards use different conditions.
- **Fix Direction:** make the writer also protect a value that starts with `'`, and
  have the reader undo exactly that.
- **Verification Plan:** round-trip test for values starting with `'` and with each
  formula character.

### R24 — Low / High confidence / Data layer

- **Location:** `src/lib/indexSerialization.ts` — `deserializeIndexFromJson`.
- **Actual Behavior:** the writer stamps `version: 1` but the reader ignores
  `version` entirely, so a file from a different schema revision is silently mapped
  onto the v1 shape; weights are then clamped and defaulted, silently re-weighting or
  dropping constituents.
- **Expected Behavior:** an unknown schema revision must be reported.
- **Root Cause:** the version field was written but never read.
- **Fix Direction:** accept a missing version and version 1; report anything else.
- **Verification Plan:** test an unknown version is rejected with a clear error.

### R25 — Low / Medium confidence / Data layer

- **Location:** `src/lib/marketDataService.ts` — `buildDefaultMarketQuotes`.
- **Actual Behavior:** the fallback sparkline rounds to 2 decimals regardless of price
  scale, so `EURUSD=X` (1.065) collapses to `[1.06, 1.06, 1.06, 1.07, 1.06]` whose
  last point is not the quoted price and whose 4th point is above it — and disagrees
  with the Worker, which applies a scale-aware rule.
- **Expected Behavior:** client and server must agree on the same symbol.
- **Root Cause:** the scale-aware rounding rule was implemented only on the server.
- **Fix Direction:** mirror the Worker's rule on the client.
- **Verification Plan:** test a sub-2 FX quote.

### R26 — Low / High confidence / DB layer

- **Location:** `schema.sql` vs `worker/internal-impl.ts` — `snapshot_cache`.
- **Actual Behavior:** `schema.sql` creates the table with `CHECK (id = 1)` while the
  runtime provisioner creates it without the constraint, so the two provisioning paths
  produce non-equivalent schemas and the single-row invariant the Worker's queries
  rely on is not guaranteed on worker-provisioned databases.
- **Expected Behavior:** both provisioning paths must produce the same schema.
- **Root Cause:** the two definitions were maintained separately.
- **Fix Direction:** make the runtime provisioner match `schema.sql`.
- **Verification Plan:** assert both definitions carry the same constraint.

### R27 — Low / High confidence / Infrastructure

- **Location:** `.github/workflows/ci.yml`.
- **Actual Behavior:** the workflow has no `concurrency` group, so superseded runs are
  not cancelled and CI minutes are spent on stale commits.
- **Expected Behavior:** CI should cancel superseded runs (as `deploy.yml` already does).
- **Root Cause:** the setting was omitted.
- **Fix Direction:** add a `concurrency` group with `cancel-in-progress: true`.
- **Verification Plan:** inspect the workflow file.

### R28 — Low / Medium confidence / Infrastructure

- **Location:** `wrangler.jsonc` — `observability`.
- **Actual Behavior:** `observability.enabled: false` is the master switch for the
  observability product, so the nested `logs.enabled: true` / `invocation_logs: true`
  / `persist: true` block is never applied; the file states an intent that the parent
  flag contradicts.
- **Expected Behavior:** the configuration must express one intent.
- **Root Cause:** a master switch was left disabled while the sub-settings were
  enabled.
- **Fix Direction:** enable observability so the declared log settings take effect.
- **Verification Plan:** inspect the resolved Wrangler config.

### R29 — Low / High confidence / UI hook

- **Location:** `src/hooks/useModalFocus.ts`.
- **Actual Behavior:** `onCloseRef.current = onClose` executes during render, which
  React forbids; a discarded render can leave the hook holding a callback closed over
  uncommitted props.
- **Expected Behavior:** refs must not be mutated during render.
- **Root Cause:** the "latest callback" pattern was implemented with a render-phase
  assignment instead of an effect.
- **Fix Direction:** assign in an effect (as `TurnstileWidget` already does).
- **Verification Plan:** `src/hooks/useModalFocus.test.tsx` renders a dialog and
  proves the observable contract (initial focus, Tab wrap, Escape ownership,
  body lock, focus restoration) that the render-phase write would break.

### R30 — Low / High confidence / UI component

- **Location:** `src/components/TradingViewChartModal.tsx`.
- **Actual Behavior:** the animation timeout, the scheduled resize notifications
  and the `requestAnimationFrame` handle survived unmount, so they fired against an
  unmounted component and dispatched a global `resize` event that nothing handled.
- **Expected Behavior:** all scheduled work must be cancelled on unmount.
- **Root Cause:** the timers were created without an owning cleanup effect.
- **Fix Direction:** track and clear every timer and the RAF in an unmount cleanup.
- **Verification Plan:** `src/components/tradingViewChartModalCleanup.test.tsx`
  renders the modal under fake timers, unmounts it, and asserts that no timer
  remains, no post-unmount `resize` is dispatched, and a pending drag frame is
  cancelled.

### R31 — Low / Medium confidence / UI component

- **Location:** `src/components/AdminDashboard.tsx`, `PortfolioManagerPage.tsx`,
  `AuthModal.tsx`.
- **Actual Behavior:** the countdown's interval depends on the value it decrements, so
  every tick tears the interval down and creates a new one; each tick restarts a full
  second, which drifts the advertised remaining time and churns ~900 timers per
  lockout.
- **Expected Behavior:** the interval should be created once and read the latest value
  through a functional updater.
- **Root Cause:** the countdown value was used both as the interval's subject and as
  its dependency.
- **Fix Direction:** depend only on the "is counting down" condition; the three
  copies are now one `src/hooks/useLockoutCountdown.ts`.
- **Verification Plan:** `src/hooks/useLockoutCountdown.test.tsx` drives the hook
  with fake timers: one interval per lockout, tick-by-tick decrement with no
  recreation, a single expiry callback, early clear, and a non-finite server
  duration that must not keep the lock forever.

### R32 — Low / Medium confidence / UI component

- **Location:** `src/components/IndexBuilderContent.tsx` — `executeSaveRef`.
- **Actual Behavior:** the ref is assigned during render, so it can hold a closure over
  state that was never committed; the post-login retry would then save a stale
  name/basket.
- **Expected Behavior:** refs must not be mutated during render.
- **Root Cause:** same pattern as R29.
- **Fix Direction:** assign in an effect.
- **Verification Plan:** `src/components/indexBuilderPostAuthSave.test.tsx`
  attempts a save signed out, edits the name, completes login, and asserts the
  retry saves the edited name rather than the pre-login closure.

### R33 — Low / Medium confidence / UI hook

- **Location:** `src/hooks/useSimulation.ts` — the sync pre-flight.
- **Actual Behavior:** the comment calls the sync "background", but every
  `/api/sync-prices` batch is awaited before `/api/calculate` is requested, and every
  sync error is discarded with no user-visible warning — the sibling hook surfaces
  these.
- **Expected Behavior:** sync failures must be visible, and the preview must not be
  blocked on work whose failure is not reported.
- **Root Cause:** the pre-flight was written as an all-or-nothing step.
- **Fix Direction:** collect warnings and surface them, matching `useCalculation`.
- **Verification Plan:** test that a failed sync batch produces a warning.

### R34 — Low / High confidence / UI hook

- **Location:** `src/hooks/useCalculation.ts` — `syncedTickersRef`.
- **Actual Behavior:** the in-memory map keeps one entry per distinct ticker for the
  hook's lifetime and takes precedence over the pruned `localStorage` mirror, so it is
  the only unbounded structure in the hook.
- **Expected Behavior:** the in-memory mirror must be pruned like the persisted one.
- **Root Cause:** only the persisted copy had an expiry rule.
- **Fix Direction:** apply the same 7-day pruning to the in-memory map.
- **Verification Plan:** test that stale entries are pruned.

### R35 — Low / High confidence / Data layer

- **Location:** `src/lib/marketDataService.ts` — the Japan CPI calendar event.
- **Actual Behavior:** every other macro event reads
  `MACRO_METRICS_DEFAULTS`; only `macro-jp-cpi` duplicates the literals, and
  `MACRO_METRICS_DEFAULTS.jpCpi` is referenced nowhere. The duplicated description
  already differs in wording from the master copy.
- **Expected Behavior:** there must be a single source of truth.
- **Root Cause:** one event was added without wiring it to the shared default.
- **Fix Direction:** read the shared default.
- **Verification Plan:** assert the event matches `MACRO_METRICS_DEFAULTS.jpCpi`.

### R36 — Low / Medium confidence / UI component

- **Location:** `src/components/AdminDashboard.tsx` — the role radio group;
  `src/components/Sidebar.tsx` — the duplicated nav landmark.
- **Actual Behavior:** the group label has no `htmlFor` and wraps no control, and the
  radios have no fieldset/legend, so assistive technology announces two unrelated
  radio buttons. The desktop rail and the mobile drawer both render the same `nav`
  element with the identical `aria-label`, so a mobile viewport exposes two
  identically named navigation landmarks.
- **Expected Behavior:** groups must be named, and landmarks must be distinguishable.
- **Root Cause:** markup was duplicated without an id/label relationship.
- **Fix Direction:** extract the selector into `RoleRadioGroup`
  (`role="radiogroup"` + `aria-label`) and give the drawer a distinct label.
- **Verification Plan:** `src/components/navigationAccessibility.test.tsx`
  renders the sidebar with the drawer open and asserts two navigation landmarks
  with distinct accessible names, then renders `RoleRadioGroup` and asserts one
  named radiogroup containing both radios and the selection callback.

---

### R37 — Medium / High confidence / Data layer

- **Location:** `src/lib/indexEngine.ts` — `redistributeWeightsExact`.
- **Actual Behavior:** the largest-remainder allocation floored every share
  independently, so a basket with many small constituents produced a weight of
  exactly `0`. The Worker's `/api/calculate` and `/api/indices` contracts
  require `weight > 0`, so the "normalize the weights" action made the basket
  unsaveable (HTTP 400) instead of normalizing it.
- **Expected Behavior:** every constituent keeps a strictly positive weight and
  the total still equals 100.
- **Root Cause:** the floor step had no reserved minimum, and the excess that
  the reservation creates was taken back one unit per entry (so it could not
  absorb an excess larger than the number of entries).
- **Fix Direction:** reserve one unit per entry before distributing the
  remainder, and let the largest entries give up more than one unit.
- **Verification Plan:** a basket with one dominant constituent and 199 tiny
  ones must keep every weight > 0 and still sum to 100. (Found while writing
  the R21 regression test — the first version of the fix still left the sum at
  100.99, which the new test caught.)

### R38 — Medium / High confidence / Tooling

- **Location:** the whole test suite (`src/**/*.test.ts`, `src/**/*.test.tsx`).
- **Actual Behavior:** no type check ever looked at the test files. Enabling
  one (R17) immediately surfaced 34 real type errors that had been invisible:
  stale fixtures using fields removed from `PortfolioPosition` (`theme`,
  `currency`, `costPrice`, `market`), a fixture using `data` instead of
  `series`, a broken import (`PricePoint` imported from a module that does not
  export it), an `@ts-expect-error` directive that no longer suppressed
  anything, a `Window` passed where the API accepts a structural subset, and
  several assertions comparing literal types with no overlap.
- **Expected Behavior:** the fixtures match the contracts they exercise.
- **Root Cause:** the fixtures drifted away from the types while the type
  check was disabled.
- **Fix Direction:** update the fixtures to the current contracts and introduce
  shared factories (`src/test-helpers/`) so a fixture states only what the
  test cares about.
- **Verification Plan:** `tsc -p tsconfig.test.json` is part of `npm run build`
  and must stay clean.

### R39 — Medium / High confidence / Test quality

- **Location:** `src/lib/comprehensiveGoalFinalReview.test.ts` — the
  "normalizes tiny negative contribution percentages to positive 0" case.
- **Actual Behavior:** the fixture's stock had no price series at all, so the
  contribution was trivially `0` and the assertion passed without ever
  reaching the `-0` normalization. The test claimed to guard a behavior it did
  not exercise.
- **Expected Behavior:** the fixture produces a genuinely tiny negative raw
  contribution so the normalization is exercised.
- **Root Cause:** the fixture was written for an older `StockSeries` shape
  (`data` instead of `series`), which silently produced an empty series.
- **Fix Direction:** give the fixture a real series and a small previous index
  value so the raw contribution is a small negative number, and assert the
  normalized value is exactly `+0`.
- **Verification Plan:** the assertion `contributionPt === 0` fails if the
  normalization is removed (the raw value is `-10` without it).

### R40 — Low / High confidence / Test quality

- **Location:** `src/lib/comprehensiveGoalCodeReviewFinalAuditPass.test.ts` —
  the iCalendar export assertion.
- **Actual Behavior:** the production export prefixes the description with
  `【重要度】<importance>`, but the assertion expected a description without
  the prefix. It only passed because the fixture omitted `importance` — which
  the type contract now requires, so the assertion would have broken the
  moment the fixture was corrected.
- **Expected Behavior:** the assertion describes the output that is actually
  produced.
- **Root Cause:** the assertion was written against an older output format.
- **Fix Direction:** assert the full escaped description including the
  importance prefix.
- **Verification Plan:** the assertion is executed by the test suite.

### R41 — Low / High confidence / Data layer

- **Location:** `src/lib/portfolioStorage.ts` —
  `convertPortfolioToCustomIndexBasket`, `src/lib/weights.ts` —
  `allocateIntegerWeights`.
- **Actual Behavior:** the basket weights are percentages and the builder
  displays them as such, but the allocation sums to `max(constituents, 100)`:
  with more than 100 distinct positions the basket sums to more than 100.
  The computed index is unaffected (the engine normalizes by the sum), but the
  stored and displayed weights are inconsistent with the percentage semantics.
- **Expected Behavior:** the contract of the allocator is stated truthfully, so
  a caller cannot rely on a sum of exactly 100.
- **Root Cause:** an integer allocation with a minimum of one unit per entry
  and a total of 100 is only satisfiable while the number of entries stays
  below 100; the two invariants conflict beyond that.
- **Fix Direction:** keep the integer weights (the Worker contract and the
  existing fixtures rely on them) and state the reachable sum explicitly
  instead of promising an unreachable one.
- **Verification Plan:** the allocator's contract is asserted directly
  (`src/lib/persistenceHardening.test.ts`).

---
### R42 — Critical / High confidence / UI hook

- **Location:** `src/hooks/useAuth.ts`, `src/lib/auth.ts`.
- **Actual Behavior:** the request identity and the `AbortController` lived in
  `useRef`s inside the hook, and `useAuth()` is instantiated about a dozen
  times. The login is started by the auth modal while the logout is performed
  in the header, so the header's `logout()` cancelled *its own* (empty)
  controller and the modal's request kept running. When it resolved it
  persisted the session again and re-authenticated the user right after they
  logged out.
- **Expected Behavior:** the attempt identity is shared by every consumer, so
  any logout cancels the attempt that is currently running, wherever it was
  started.
- **Root Cause:** the cancellation state was scoped to the component instead
  of to the authentication attempt.
- **Fix Direction:** move the identity and the controller into a module-level
  singleton in `src/lib/auth.ts` (`beginAuthAttempt`,
  `cancelPendingAuthAttempt`, `isCurrentAuthAttempt`).
- **Verification Plan:** a test renders two hook instances, starts a login in
  one and logs out in the other, and asserts that the session is not
  resurrected.

### R43 — Medium / High confidence / Data layer

- **Location:** `src/lib/marketDataService.ts` — `sanitizeStockFundamentals`.
- **Actual Behavior:** the sanitizer enumerates the fields explicitly instead
  of spreading the payload, and it did not copy `isEstimatedPer` or
  `perNote`. A PER that the Worker had derived from the latest results (TTM)
  was therefore displayed as a company-guided multiple, and the note that
  explains the estimate was lost.
- **Expected Behavior:** the PER disclosure survives the validation.
- **Root Cause:** the field list of the sanitizer was incomplete.
- **Fix Direction:** copy the two disclosure fields explicitly and reset them
  when the payload does not carry them.
- **Verification Plan:** a client-side test asserts both the preserved and the
  cleared case.

### R44 — Medium / High confidence / UI component

- **Location:** `src/components/StockTechnicalChart.tsx` — the preflight
  sync.
- **Actual Behavior:** the ticker was marked as "synced" before the request
  was sent, so a failed write was never retried: the ticker stayed marked for
  the lifetime of the component even though the D1 cache was never updated.
  Before the write guard existed, every quote refresh re-issued the request
  and a transient failure self-healed.
- **Expected Behavior:** the ticker is marked as synced only after the write
  succeeded.
- **Root Cause:** the guard recorded the intent instead of the result.
- **Fix Direction:** set the marker only when the response is `ok`.
- **Verification Plan:** a test makes the first write fail and asserts that
  the next run retries it.

### R45 — Medium / High confidence / UI component

- **Location:** `src/components/AuthModal.tsx`,
  `src/components/AdminDashboard.tsx`,
  `src/components/PortfolioManagerPage.tsx`.
- **Actual Behavior:** a superseded authentication attempt was reported
  through the same channel as a wrong password. The auth modal therefore
  displayed "認証がキャンセルされました" **and** reset the Turnstile widget,
  destroying a CAPTCHA the user had already solved, for an attempt that never
  actually failed.
- **Expected Behavior:** a cancellation is distinguishable from a failure: no
  error is shown and the solved Turnstile token is kept.
- **Root Cause:** the hook had only one failure channel.
- **Fix Direction:** return a `cancelled` marker and let the call sites skip
  the error and the Turnstile reset.
- **Verification Plan:** a test asserts that a superseded attempt resolves
  with `cancelled: true` and without an error message.

### R46 — Low / High confidence / UI hook

- **Location:** `src/hooks/useSimulation.ts` — the error path and the local
  recompute paths.
- **Actual Behavior:** every branch checked the request identity except the
  error path, which only checked the abort signal; and the sync warnings of a
  failed run stayed on screen after the data had been recomputed locally.
- **Expected Behavior:** a superseded request never publishes demo data, and
  the warning describes what is currently displayed.
- **Root Cause:** the guard was applied branch by branch instead of
  consistently.
- **Fix Direction:** check the request identity in the error path too and
  clear the warnings on the local recompute paths.

### R47 — Low / High confidence / Process

- **Location:** `plans/comprehensive-review-findings.md`.
- **Actual Behavior:** the findings list had been written twice end to end
  (1377 lines instead of 707), so the document described every change twice.
- **Expected Behavior:** one canonical list.
- **Root Cause:** the merge step that inserted the new findings appended
  instead of replacing.
- **Fix Direction:** rebuild the document from the first copy and verify that
  it contains exactly one title, one summary and one verification section.

### R48 — Low / High confidence / Test quality

- **Location:** `src/lib/syncCacheKey.test.ts`.
- **Actual Behavior:** the test re-implemented the sync cache's
  read-modify-write locally and then asserted that its own copy agreed with
  itself. The anti-pattern that R19 removed from the production code was
  still present in the repository, inside a test.
- **Expected Behavior:** the test exercises the production module.
- **Root Cause:** the test was written before the module existed and was never
  updated.
- **Fix Direction:** import the shared module and assert that the hook's
  re-exported surface points at the same key.
- **Verification Plan:** the rewritten test fails if the two surfaces drift
  apart.

### R49 — Medium / High confidence / Data layer

- **Location:** `src/components/PortfolioManagerPage.tsx` — `handleAddPosition`.
- **Actual Behavior:** the add form built `{ id: `pos-${Date.now()}` }` inline.
  R20 had fixed the same class in `sanitizePosition`, but the live add path never
  used the factory introduced for it, so two positions added within the same
  millisecond would share an id: duplicate React keys, and a delete that removes
  both lots.
- **Expected Behavior:** exactly one place mints position ids.
- **Root Cause:** R20 repaired a call site instead of the ownership boundary; the
  id generator was still exported and position construction was open-coded in the
  component.
- **Fix Direction:** `createPortfolioPosition` is now the only constructor and
  assigns the id; `createPortfolioPositionId` is module-private;
  `addPortfolioPosition` accepts the economic fields only (no `id`), and the page
  passes those fields.
- **Verification Plan:** freeze `Date.now`, then add two identical lots.
  `src/lib/persistenceHardening.test.ts` asserts distinct ids from the factory and
  two persisted lots with unique ids through `addPortfolioPosition`.

### R50 — Medium / High confidence / Test quality

- **Location:** `useModalFocus`, `TradingViewChartModal`, the three lockout
  countdowns, `IndexBuilderContent`'s post-login save, `Sidebar` and the role
  selector.
- **Actual Behavior:** R29–R32 and R36 were marked FIXED with a "source-level
  regression assertion" as their verification. A grep for `clearTimeout` cannot
  prove a timer no longer fires; a grep for `onCloseRef` cannot prove a ref is not
  written during render; a grep for `aria-label` cannot prove two landmarks are
  distinguishable in the accessibility tree.
- **Expected Behavior:** behavior a user can experience is verified by exercising
  it, and grep-only checks are not counted as proof of a behavioral fix.
- **Root Cause:** the verification plan for UI-only fixes stopped at "the text is
  present", because the affected state was buried inside large components.
- **Fix Direction:** extract the shared behavior, then test it through the DOM:
  `useLockoutCountdown` replaces three copies of the countdown,
  `RoleRadioGroup` replaces the inline radio group. Delete the source-text
  assertions that were the only guard for these fixes rather than leaving them to
  inflate the count.
- **Verification Plan:** `useModalFocus.test.tsx` (focus, Tab wrap, Escape
  ownership, body lock, focus restore), `tradingViewChartModalCleanup.test.tsx`
  (load timeout, post-load notification, animation timers, pending drag frame),
  `useLockoutCountdown.test.tsx` (one interval, expiry once, early clear,
  non-finite duration), `indexBuilderPostAuthSave.test.tsx` (the retry saves the
  post-login name) and `navigationAccessibility.test.tsx` (two named landmarks,
  named radiogroup).

### R51 — High / High confidence / Security — ACCEPTED RISK

- **Location:** `src/lib/auth.ts` (`sanitizeAuthSession`, session persistence),
  `worker/internal-impl.ts` (`x-auth-password` handling, `authCache`).
- **Actual Behavior:** the session object includes the plaintext password; it is
  persisted in `sessionStorage` and sent as `x-auth-password` on every
  authenticated request, where the Worker re-derives PBKDF2 and caches the result
  in memory. Logout only clears the tab's storage: a password captured before
  logout still authenticates every endpoint until it is changed.
- **Why it is retained:** replacing the protocol requires a D1 session table and
  migration, a token-issuing endpoint, revocation on logout/password change, and
  changes to every client call site and Worker guard. That is a separate,
  migration-bearing change, not a review-cycle fix; changing it half-way would
  weaken both models.
- **Mitigations in place:** transport is HTTPS-only; the session lives in
  `sessionStorage` (not `localStorage`), so it dies with the tab; the Worker
  compares PBKDF2 hashes, rate-limits login (`AUTH_RATE_LIMIT_MAX = 10`) and tries
  the full account set for a matching password; Turnstile gates login.
- **Residual risks:** XSS can read the password (not merely a token); logout is
  not a revocation; per-device session listing/audit is impossible; password
  rotation is the only revocation mechanism.
- **Revisit when:** multi-device sessions, admin audit trails, or a "log out all
  devices" feature are requested.

### R52 — Low / High confidence / Security — OPEN

- **Location:** `src/lib/ownership.ts` (`getStore`, `saveIndexOwnerToken`).
- **Actual Behavior:** custom-index ownership is a bearer token in `localStorage`
  with no expiry and no rotation. The token is removed when the index is deleted
  (`useIndices.removeIndexOwnerToken`), but if the delete fails, or the browser
  profile is copied, the token remains valid forever.
- **Expected Behavior:** a bearer credential should have a bounded lifetime or be
  rotatable.
- **Root Cause:** ownership was modelled as a local convenience flag rather than a
  credential lifecycle.
- **Suggested Fix Direction:** store `{ token, issuedAt }` with a maximum age,
  refresh it on successful owner-authenticated writes, and prune expired entries
  when the store is read. Pair it with the Worker's `owner_token_hash` check so an
  expired token is rejected server-side too.
- **Not fixed in this pass:** changing the stored shape needs a migration for
  existing owners; the current code's corrupt-storage path would otherwise drop
  their tokens silently.

### R53 — Low / High confidence / Test quality — OPEN

- **Location:** `src/**/*.test.ts(x)`.
- **Actual Behavior:** 85 of 191 test files still use `readFileSync` to assert on
  production source text (837 `it`/`test` blocks at the time of measurement).
  R29–R32/R36 no longer rely on them, but the rest remain.
- **Expected Behavior:** the suite's cost should buy behavior coverage.
- **Root Cause:** each review round added a file that asserted the patch it had
  just written, and the names record the round rather than the capability.
- **Suggested Fix Direction:** convert files whose subject is behavior (focus,
  timers, ARIA, event handling) to DOM tests; delete assertions that only restate
  an implementation detail; rename the rest after the capability they protect.
  Do this in batches, one capability per commit, so a failing test names a
  behavior.

---

## Performance (measured)

Every number below was measured on this checkout on 2026-10-20 with the
commands named next to it. Nothing in this section is an estimate.

### First paint: what is actually downloaded

Source: `dist/index.html` after `npm run build`, plus `wc -c` / `gzip -9` on
each preloaded asset. Vite writes `modulepreload` links for every chunk in the
entry graph, so the table is the real initial transfer, not the sum of all
chunks.

| Asset | Raw bytes | gzip bytes | `modulepreload` |
|-------|----------:|-----------:|:---:|
| `index-*.js` (entry) | 505,925 | 154,027 | — (module entry) |
| `recharts-*.js` | 419,810 | 112,819 | yes |
| `stock-universe-*.js` | 303,159 | 64,365 | yes |
| `motion-*.js` | 137,119 | 44,972 | yes |
| `index-*.css` | 132,558 | 22,972 | stylesheet |
| `lucide-*.js` | 38,237 | 7,486 | yes |
| **First paint total** | **1,536,808** | **406,641 (≈397 KiB)** | |

Full build output: 20 files / 2,411,225 bytes; 2,735 modules; `vite build`
4.05 s including the three `tsc --noEmit` projects.

**P1 — OPEN / High.** The 4,805-line stock dataset is on the critical path even
though the only consumer in the entry graph is one string normalizer:
`src/lib/marketDataService.ts` does
`import { normalizeSearchQuery } from "../data/stockUniverse"`, and
`marketDataService` is imported by the entry bundle (portfolio, dashboard,
search). That pulls 303 KB raw / 64.4 KB gzip before the dashboard renders.
*Fix direction:* move `normalizeSearchQuery` (a pure string helper) into its own
module and let the dataset stay behind the lazy screeners that actually need it.
*Expected effect:* −64.4 KB gzip from first paint, no behavior change.

**P2 — OPEN / Medium.** `recharts` (419.8 KB / 112.8 KB gzip) is preloaded on
first paint although charts only render inside the dashboard/detail views.
*Fix direction:* import chart components through the lazy route boundary (or a
`lazy(() => import(...))` inside the card) so the library is fetched with the
page that draws charts.

### Worker bundle

`npx wrangler deploy --dry-run --config wrangler.jsonc`: exit 0, 25 files,
814.98 KiB raw / 133.49 KiB gzip, bindings `env.DB` + `env.ASSETS`. Comfortably
inside the Workers upload limit; no action required.

### Runtime work (median of 25 runs, Node, `performance.now()`)

| Operation | Input size | Median |
|-----------|-----------:|-------:|
| `createTreemapLayout` (theme heatmap) | 300 sectors | 0.52 ms |
| `redistributeWeightsExact` (normalize action) | 200 constituents | 0.14 ms |
| `calculatePortfolioSummary` | 500 positions | 2.64 ms |

These are far below a frame budget at realistic portfolio sizes, so there is no
CPU hotspot to chase in the rendering path. The remaining costs are transfer
size (P1/P2) and the D1 purge scan that R14 already indexed.

### Suite cost

`npm test`: 191 files / 1,773 tests in 7.02 s. The suite is not a bottleneck,
but 85 of those files spend their assertions on source text (R53), so a fast
suite is not the same as a meaningful one.

---


## Discarded (false positives)

| Candidate | Why it was discarded |
|-----------|---------------------|
| `tsconfig.json` references non-composite projects break `tsc -b` | `npx tsc -b --dry` completes successfully (exit 0) and resolves both referenced projects. The references are valid. |
| `schema.migration.sql` is not idempotent | The file's own header (lines 3-15) documents that SQLite cannot do `ADD COLUMN IF NOT EXISTS`, that the file is intentionally once-only, and that running it after `schema.sql` is incorrect. This is an intended, documented procedure — not a defect. |
| `findPasswordCollision` caps verification at 200 rows | The cap is explicitly documented as a CPU guard (not an account limit) and is deliberately far above any realistic account count. Intentional design. |
| `MAX_AUTH_ROW_VERIFICATIONS = 200` could lock out accounts | The cap only aborts with a distinct, diagnosable error; the previous value of 15 was the actual bug and is already fixed. |
| `escapeCsvCell` does not prefix plain negative numbers | Deliberate: a bare number cannot execute as a spreadsheet formula, and prefixing it corrupts numeric cells. Documented in the file header. |

| `access_passwords` needs an index on `created_at` / `is_active` | The table holds the (few) user accounts of a single deployment, so the ordering scan is over tens of rows. An index would add write cost without a measurable benefit — an unnecessary change. |
| The portfolio-to-basket weights should become fractional so they always sum to 100 | The Worker contract and the existing fixtures rely on integer weights, and the computed index is unaffected because the engine normalizes by the sum. The reachable contract is now stated explicitly (R41) instead of changing the persisted format. |

---

## Verification

Every `FIXED` finding is implemented and covered by a test that exercises it.
`OPEN` and `ACCEPTED RISK` entries are listed in the summary and are not
counted as verified. Final run of the full suite on this checkout:

| Check | Command | Result |
|-------|---------|--------|
| Static analysis | `npm run lint` | exit 0, no warnings |
| Type check (browser) | `tsc -p tsconfig.app.json --noEmit` | clean |
| Type check (Worker) | `tsc -p tsconfig.worker.json --noEmit` | clean |
| Type check (tests) | `tsc -p tsconfig.test.json --noEmit` | clean |
| Tests | `npm test` | 191 files / 1,773 tests passing, 7.02 s |
| Build | `npm run build` | 2,735 modules, 4.05 s, three type checks pass |
| Worker bundle | `wrangler deploy --dry-run` | exit 0, 25 files, 814.98 KiB / 133.49 KiB gzip |

Regression tests added for the behavioral fixes (R1–R50). Files added in the
R49/R50 pass replace the source-text assertions that used to guard R29–R32 and
R36 — those grep assertions were deleted, not kept alongside the new tests:

| Test file | Covers |
|-----------|--------|
| `src/hooks/useModalFocus.test.tsx` | R29, R50 (initial focus, Tab wrap, Escape ownership, body lock, focus restore) |
| `src/components/tradingViewChartModalCleanup.test.tsx` | R30 (load timeout, post-load notify, animation timers, pending drag frame) |
| `src/hooks/useLockoutCountdown.test.tsx` | R31 (one interval, expiry once, early clear, non-finite duration) |
| `src/components/indexBuilderPostAuthSave.test.tsx` | R32 (retry saves the post-login name) |
| `src/components/navigationAccessibility.test.tsx` | R36 (two named landmarks, named radiogroup) |
| `src/lib/persistenceHardening.test.ts` | R49 (frozen clock, two lots in one millisecond) |

Earlier regression tests for R1–R28 and R37–R48:

| Test file | Covers |
|-----------|--------|
| `src/hooks/useSimulation.loopGuard.test.tsx` | R1 (unbounded render loop), R3 (stale response) |
| `src/hooks/useAuth.requestIdentity.test.tsx` | R6, R42 (superseded login, cross-instance logout), R45 (`cancelled` marker) |
| `src/hooks/useIndices.conditionalRequest.test.tsx` | R4 (ETag/body atomicity), R16 (unmount abort) |
| `src/lib/syncCache.test.ts` | R7, R19, R34 (shared sync cache) |
| `src/lib/syncCacheKey.test.ts` | R48 (one key for both hooks) |
| `src/lib/persistedPayloadValidation.test.ts` | R5, R15 (runtime validation of persisted payloads) |
| `src/lib/marketDataHardening.test.ts` | R9, R10, R22, R25, R43 (PER disclosure) |
| `src/lib/persistenceHardening.test.ts` | R20, R21, R23, R24, R37 |
| `src/components/uiHardening.test.tsx` | R2, R11, R13, R44 (preflight write retry) |
| `src/lib/infrastructureContracts.test.ts` | R14, R26, R27, R28 |
