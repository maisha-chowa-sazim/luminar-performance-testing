---
name: luminar-k6-test-runner
description: Create, run, and interpret Luminar k6 functional and performance tests using this project's business flows, role accounts, load profiles, and PDF reporting runner. Use for Luminar smoke tests, full-journey validation, load tests, arrival-rate tests, dashboard runs, and comparisons with earlier results.
---

# Luminar k6 Test Runner

Use the existing Luminar suite to validate business journeys and measure performance. Produce reproducible runs, preserve threshold failures, and explain findings using actual metrics. Resolve paths and run commands from the repository root, one level above this file.

## Project sources

Read the relevant current implementation before selecting or changing a test:

| Source | Purpose |
| --- | --- |
| `k6/README.md` and `package.json` | Run commands, prerequisites, environment loading, and report behavior |
| `k6/scenarios/` | Available executable scenarios and functional coverage |
| `k6/config/performance.js` | VU profiles, provisional thresholds, and endpoint metric names |
| `k6/config/functional-thresholds.js` | Functional acceptance criteria |
| `k6/flows/` | Reusable business actions and performance journey instrumentation |
| `k6/helpers/` | Authentication, session pools, tenant headers, approvals, and unique identifiers |
| `k6/data/` | Role-to-environment-key mappings, payload fixtures, and tech-pack binaries |
| `k6/reporting/run.mjs` and `report.mjs` | Execution, run metadata, summary parsing, PDF/HTML generation |
| `k6/tests/` | Offline reporting and session-pool verification |

Historical investigations in `docs/` can explain earlier failures, but verify their claims against current code. This skill adapts the supplied load-testing and test-runner references to Luminar. Their Virtual Care URLs, Rails assumptions, Firestore uploads, scripts, and dashboards do not apply here. Luminar currently stores reports locally; uploading or publishing results requires a separate request.

## Establish the requested run

Identify the target environment, scenario, workload, and intended output from the user's request and existing session context. Inspect configuration without displaying secrets. Ask only for missing information that affects execution; never guess a production target or a requested load level.

Creating or editing tests does not authorize running live traffic. For an authorized run, stay within the requested environment, scenarios, and workload. Do not automatically run the whole suite, escalate load after failures, or repeat write-heavy journeys to obtain a passing result.

The business scenarios create persistent styles, samples, BOMs, costings, orders, receipts, and uploaded objects. The documented execution target is disposable QA. If asked to target production, explain this constraint and resolve the environment before running business traffic. There is no complete API teardown. A comparable reset uses an approved QA seed snapshot and the environment's test-object cleanup process; do not reset a database or delete storage as part of an ordinary test run.

## Environment and data preflight

- Use Node.js 22+ and the project's compatible k6 binary; the README records validation with k6 2.2.0. Install pinned reporting dependencies with `npm ci` when needed.
- The Node runner loads root `.env`; values already in the process environment take precedence. Select another existing dotenv file with `node --env-file=.env.qa k6/reporting/run.mjs <scenario>`. An `ENV=qa` argument does not select a Luminar configuration. `k6/config/env.js` is deprecated.
- Require an explicit `BASE_URL` for the intended environment. Check `LUMINAR_FACTORY_ID`, `LUMINAR_BUYER_ID`, role credentials, and any required `LUMINAR_ORGANIZATION_ID` against the same tenant. Do not rely on helper fallback IDs as evidence that the environment is ready.
- Read credential variable names from `k6/data/users.json`. Performance setup requires all 42 credential pairs: 20 merchandisers, 20 inventory accounts, one executive, and one senior merchandiser. Functional scenarios use the roles selected by their implementation and `helpers/auth.js`.
- Check buyer, garment-size template, measurable items, suppliers, variants, and purchase references in the relevant fixtures. Preserve the existing `data/recieve-item.json` spelling. Verify tech-pack filenames against `data/techpack/` and maintain valid business dates, including any `LUMINAR_SHIPMENT_DATE` override.
- Keep credentials, tokens, cookies, signed upload URLs, and raw response bodies out of shared reports and chat. Some existing failure logs contain response bodies; inspect and sanitize diagnostics before sharing them.

## Select a scenario

Use only entrypoints that exist in `k6/scenarios/`.

| Intent | Scenario or command | Behavior |
| --- | --- | --- |
| Check all performance accounts | `login-all-users` | One VU, 42 sequential authentication iterations; no business records |
| Basic business smoke | `npm run test:smoke` | One VU/iteration; style and purchase-order flow with approval |
| Validate one feature | `style-smoke`, `sample-smoke`, `tech-pack-smoke`, `bom-smoke`, `pre-costing-smoke` | Read the selected scenario for role and resource dependencies |
| Validate linked flows | `style-to-pre-costing-flow`, `work-order-and-receive-item-flow` | Functional coverage for the selected chain |
| Complete business journey | `full-journey` | One VU/iteration through item receipt |
| Light load | `npm run test:load:5` | 5 VUs: 1m ramp up, 3m hold, 1m ramp down |
| Target profile | `npm run test:load:10` | 10 VUs: 2m ramp up, 14m hold, 2m ramp down |
| Higher load | `npm run test:load:20` | 20 VUs: 2m ramp up, 6m hold, 2m ramp down |
| Fixed journey arrival rate | `load-arrival-rate` | Default 5 starts/minute for 5m, 20 preallocated VUs |

The 50/100-VU npm scripts and profile definitions currently remain, but their scenario files are absent. Do not advertise them as runnable or recreate them unless requested. Stress, soak, and spike tests require explicit implementation and workload selection; they are not existing entrypoints.

The full journey creates style → sample → tech pack/uploads → BOM → costing/submission → purchase order → work order, then performs executive BOM/costing/purchase approvals, senior-merchandiser work-order approval and supplier status update, and inventory receipt. Preserve resource IDs and role transitions from the implementation.

For load execution, validate the functional journey before increasing concurrency when there is no applicable recent successful validation. Stop on prerequisite failures and investigate before moving to a higher authorized load.

## Authentication and pacing

Performance scenarios authenticate all 42 accounts sequentially in `setup()`, abort on any final authentication failure, and reuse those sessions for business iterations. The separate `login-all-users` run does not persist sessions for later runs.

`helpers/session-pool.js` assigns merchandiser and inventory sessions by VU ID; executive and senior-merchandiser sessions are shared. VUs represent concurrent journeys, not 42 independently active users. Arrival-rate `JOURNEY_VUS` is limited to 1–20 to avoid concurrent account reuse within each pooled role.

Authentication defaults: `LOGIN_DELAY_SECONDS=1`, `LOGIN_MAX_RETRIES=2`, and `LOGIN_MAX_RETRY_WAIT_SECONDS=120`. Only HTTP 429 is retried, respecting `Retry-After` seconds or dates; an excessive wait fails the account instead of retrying early. `LOGIN_MAX_DURATION` and `LOGIN_SETUP_TIMEOUT` default to `30m`. Do not add unbounded retries, automatic business retries, or session refresh to hide failures.

VU profiles sleep after every attempt, including failures, using `THINK_TIME_SECONDS` (default 3). Arrival-rate scheduling omits that sleep. `JOURNEY_RATE` counts journey starts per `JOURNEY_TIME_UNIT`, not HTTP requests. Select the rate from the intended workload and measured duration; each journey sends many requests. Busy VUs can cause dropped iterations, which fail the arrival-rate threshold.

## Run and retain reports

Use the Node/npm runner whenever PDF reports are required. Examples below are alternatives; execute the selected command only within the authorized scope:

```bash
# Functional journey with PDF/HTML reports, using root .env:
npm run test:performance -- full-journey

# Verify accounts in an explicitly selected environment:
node --env-file=.env.qa k6/reporting/run.mjs login-all-users

# Fixed journey arrival rate in that environment:
JOURNEY_RATE=5 JOURNEY_TIME_UNIT=1m JOURNEY_DURATION=5m JOURNEY_VUS=20 \
  node --env-file=.env.qa k6/reporting/run.mjs load-arrival-rate

# Live dashboard plus regular reports for an authorized load run:
npm run test:load:5 -- --dashboard
```

Plain `k6 run` does not load dotenv files automatically or invoke the PDF renderer. The runner produces a unique ignored directory under `k6/results/` containing `report.pdf`, `report.html`, `metadata.json`, and `summary.json` when k6 reaches summary generation. Dashboard mode additionally exports `k6-dashboard.html` by default. Retain the runner's exit status and exact output directory.

Dashboard defaults to `http://localhost:5665` with 10-second updates. Close the dashboard tab after execution so k6 can finish reporting. For export without a live server, use `K6_WEB_DASHBOARD_PORT=-1`. Inspect existing dashboard options before overriding port, interval, or export path.

Threshold failures are valid measured failures, not a reason to discard reports or relax targets. Initialization/setup failures and interruptions must be identified as incomplete. The runner can generate an incomplete report when it exits normally without a valid summary; hard termination or missing dependencies can prevent report generation. Never label a run successful merely because a PDF exists.

## Acceptance and interpretation

Functional scenarios require `checks: rate==1`; basic smoke also gates HTTP errors below 5% and HTTP p95 below 3000ms. Performance profiles currently require:

- Business-scenario HTTP failure rate `<1%`, p95 `<3000ms`, and p99 `<5000ms`.
- Checks and `journey_success` rates `>99%`.
- At least one started journey and at least one successfully completed journey.
- For arrival rate, `dropped_iterations: count==0`.

These performance targets are provisional, not agreed business SLOs. Preserve them unless the requested change supplies different criteria. Do not replace them with the generic reference's 500ms/1500ms defaults.

Read `summary.json` and `metadata.json`, then verify PDF/HTML findings against the recorded metrics. Separate HTTP request throughput, iteration count, and successful business journeys. Report p95/p99 and errors alongside completion; averages may supplement these figures. Use stable endpoint `name` metrics to locate slow or failing operations, and distinguish authentication attempts from business traffic.

Business HTTP thresholds exclude authentication setup, but aggregate report totals include setup and ramps. Graceful completion can add up to two minutes and retiring VUs may finish during ramp-down. Aggregate reports cannot establish steady-state-only latency, an exact saturation knee, or recovery timing.

When investigating degradation, correlate k6 time series with server CPU/memory, database waits/locks, queues, authentication throttling, storage throughput, and load-generator CPU/memory/network. Uploads can materially affect generator bandwidth and memory. Label suspected bottlenecks as hypotheses when server evidence is unavailable. Report capacity as unestablished unless the workload and measurements support a capacity estimate.

For comparisons, use an earlier actual run from `k6/results/` or a user-provided baseline with matching environment, scenario, profile, seed state, account model, and deployment context. If no comparable baseline exists, say so. Compare p95/p99, failure rate, completed journeys, and throughput; identify material configuration differences. Never invent previous values or present synthetic self-test reports as application results.

## Extend or repair the suite

Reuse `flows/` for business actions, `helpers/` for shared mechanics, and `scenarios/` for orchestration. Keep shared performance options in `config/performance.js` and completion instrumentation in `flows/performance-journey.js`. Preserve setup-session reuse when extending performance scenarios.

Use `helpers/unique-id.js` for identifiers that must remain distinct under concurrency. Pass created IDs into downstream actions rather than substituting static fixture IDs. Check HTTP status, business success, and required IDs before continuing. Preserve the full-journey completion check in `finally`, so early exits and exceptions count as failures.

Keep stable request `name` tags; include new endpoint names in performance/reporting coverage when needed. Preserve exclusion of dynamic URLs from performance system tags. Do not globally discard response bodies because downstream actions parse resource IDs. Maintain the runner's summary compatibility and nonzero exit-code behavior.

Validate changes with the relevant offline checks. `npm run test:reporting` exercises reporting and session-pool tooling without API traffic and creates synthetic reports. Check existing test assumptions against current scenario availability; report failures without restoring removed scenarios or changing unrelated files merely to make checks pass. Live verification is a separate action governed by the requested run scope.

## Deliverable

For an executed test, give the environment, scenario/profile, UTC run timestamp, revision, exit status, and measured PASS/FAIL/incomplete assessment. Summarize HTTP failures, p95/p99, journey completion, and arrival drops where available. Link the exact generated PDF and supporting artifacts. Include baseline changes when a comparable baseline exists and state the limits of the evidence.

For a test-design request, provide the relevant scenario/config changes, explicit workload and acceptance criteria, reproducible runner command, and validation performed. Clearly distinguish planned tests from executed measurements.
