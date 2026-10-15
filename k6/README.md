# Luminar k6 project structure

For independent concurrent Merchandiser and Inventory users (Approach B), use `npm run test:roles:smoke`, then the separate `test:roles:10`, `test:roles:20`, and `test:roles:50` commands as appropriate. See [role-based execution, handoff safety, configuration, and current verification blockers](../docs/role-based-load-testing.md). These scenarios reuse root `.env` account pools and retain functional full-journey and arrival-rate scenarios.

This project follows the flow-based pattern used in the example k6 project:

- `config/` contains environment and scenario profiles
- `helpers/` contains shared auth and HTTP utilities
- `flows/` contains business-flow actions such as login, style, tech pack, BOM, costing, sample, PO, and work order
- `scenarios/` contains feature smoke tests, the functional full journey, account verification, role-based load, and arrival-rate entrypoints

## Functional scenarios

Each functional scenario requires every k6 check to pass. The BOM, costing, sample, and tech-pack scenarios create a fresh style first. The full journey includes approvals and item receipt.

Run the scenarios independently:
```bash
node --env-file=.env.prod k6/reporting/run.mjs login-all-users
k6 run k6/scenarios/sample-smoke.js
k6 run k6/scenarios/bom-smoke.js
k6 run k6/scenarios/pre-costing-smoke.js
k6 run k6/scenarios/tech-pack-smoke.js
k6 run k6/scenarios/full-journey.js
```

## Environment variables

This project reads values from the workspace .env file and exposes them to k6 via `__ENV`.

Example values:

```bash
BASE_URL=<environment-specific-base-url>
MERCHANDISER_EMAIL=<test-user-email>
MERCHANDISER_PASSWORD=<set-locally>

LUMINAR_FACTORY_ID=<environment-specific-factory-id>
LUMINAR_ORGANIZATION_ID=<environment-specific-organization-id>
LUMINAR_BUYER_ID=<environment-specific-buyer-id>
LUMINAR_PAYMENT_PROVIDER_ID=<environment-specific-payment-provider-id>
LUMINAR_STYLE_ID=<existing-style-uuid>

LOGIN_DELAY_SECONDS=1
LOGIN_MAX_RETRIES=2
LOGIN_RETRY_BASE_SECONDS=30
LOGIN_MAX_RETRY_WAIT_SECONDS=120
LOGIN_SETUP_TIMEOUT=30m
LOGIN_MAX_DURATION=30m
THINK_TIME_SECONDS=3
```

Run with:

```bash
set -a
source .env
set +a
k6 run k6/scenarios/sample-smoke.js
```

## Seed data and cleanup

Purchase-order shipment dates come from `k6/data/purchase.json`. Each shipment defines `shipmentDate: { "daysFromToday": 30, "utcOffsetMinutes": 360 }`, which resolves to the current calendar date in Asia/Dhaka (UTC+06:00) plus 30 days when building the payload. `LUMINAR_SHIPMENT_DATE` is not required or used.

Run these scenarios only against a disposable QA environment. Keep `BASE_URL`, factory, organization, buyer, and role accounts aligned to the same tenant. Before running, verify that the buyer from `LUMINAR_BUYER_ID`, garment-size template in `style.json`, measurable items in `bom.json`, and measurable items, suppliers, purchase-order references, and variants in `work-order.json` exist and are active in that tenant. The tech-pack metadata filenames must match files under `data/techpack/`.

These scenarios create persistent records and upload objects. The API currently exposes style soft-delete and tech-pack deletion, but no complete delete workflow for BOMs, samples, costings, purchase orders, work orders, or GRNs. For a full reset, restore the disposable QA database to its approved seeded snapshot and clear the test tech-pack object prefix using the environment's object-storage cleanup/lifecycle process. Do not treat reruns as cleanup; without that reset, duplicate records and accumulated files are expected.

## Performance profiles

`load-roles.js` is the single entrypoint for independent concurrent Merchandiser and Inventory load. The former per-user load files and two partial linked-journey scripts were removed. Feature smoke tests and `full-journey.js` remain for functional diagnosis.

| Command | Merchandiser VUs | Inventory VUs | Combined peak |
| --- | ---: | ---: | ---: |
| `npm run test:load:5` | 4 | 1 | 5 |
| `npm run test:load:10` | 8 | 2 | 10 |
| `npm run test:load:20` | 16 | 4 | 20 |
| `npm run test:load:50` | 40 | 10 | 50 |

These commands now use the independent-role model, rather than one complete journey per VU. They default to 2m ramp-up, 15m steady producer load, and 2m ramp-down. Inventory continues through producer completion grace and queue draining. Targets are provisional: application HTTP p95 <2000ms, p99 <5000ms, failures <1%, and end-to-end completion >=99%, with zero integrity/quantity/duplicate-success violations. Configuration is in `config/role-load.mjs`; see the [role-based run guide](../docs/role-based-load-testing.md) for credentials, durations, handoff, smoke settings, and prerequisites. The unsupported 100-VU command was removed to respect the 50-VU role cap.

The distinct `load-arrival-rate.js` scenario retains the legacy full-journey session pool and acceptance criteria in `config/performance.js`. It authenticates all 42 accounts mapped in `data/users.json`, requires the login/environment settings above, and reuses setup sessions without automatic refresh. It schedules journey starts rather than independent role users; see the arrival-rate section below.

## Automatic stakeholder PDF reports

Prerequisites: Node.js 22+ and k6 (validated with 2.2.0). Install pinned reporting dependencies with `npm ci`. No browser or cloud reporting service is required.

Use the Node/npm runner for **every run that needs a PDF**. It loads the root `.env` automatically; existing exported environment values take precedence. Plain `k6 run` does not invoke Node's PDF renderer.

The runner passes the current process environment to k6, making values from `.env`, a selected `node --env-file`, or CI secrets available as `__ENV` variables. Run only trusted k6 scripts with this runner.

```bash
npm ci
npm run test:smoke
npm run test:performance -- full-journey
npm run test:performance -- sample-smoke
npm run test:load:5
```

Every runner invocation creates `k6/results/<UTC timestamp>-<scenario>-<unique ID>/` containing:

- `report.pdf`: shareable stakeholder report with assessment, environment/revision, profile, throughput, error rate, latency percentiles, journey completion, threshold results, endpoint breakdown (load profiles), functional checks and interpretation notes.
- `report.html`: readable/printable version of the same report.
- `summary.json`: k6 aggregate metrics, when k6 reaches summary generation.
- `metadata.json`: scenario, UTC times, revision (including dirty-tree marker), engine version and exit status.

## Built-in live web dashboard

The runner automatically enables the [standard k6 web dashboard](https://grafana.com/docs/k6/latest/results-output/web-dashboard/) for scenario names starting with `load-`, including the arrival-rate test. It sets `K6_WEB_DASHBOARD=true`, opens the browser, and exports a standalone HTML report. No separate Grafana or InfluxDB service is needed. The built-in charts show request rate, failures, latency, VUs, and iteration performance over time; use the PDF/HTML stakeholder reports for business-journey completion and endpoint summaries.

To open the live dashboard and save its standalone `k6-dashboard.html` report alongside the PDF and summary JSON:

```bash
npm run test:load:5
npm run test:load:10
npm run test:load:20
npm run test:load:arrival
# Enable it explicitly for a functional scenario:
npm run test:dashboard -- full-journey
# Select a specific environment:
node --env-file=.env.dev k6/reporting/run.mjs --dashboard load-arrival-rate
```

Use `load-roles` for independent roles or select another existing scenario under `scenarios/`. Open `http://localhost:5665` while the test runs to see live metrics. Updates default to every 10 seconds. Close its browser tab when finished so k6 can exit and the regular PDF/HTML reports can complete. Exported graphs require a test duration greater than three times the update period (over 30 seconds by default).

The runner respects standard dashboard environment options, supplied in `.env` or your shell:

```bash
# Change the port and update interval; open the URL manually:
K6_WEB_DASHBOARD_PORT=5666 K6_WEB_DASHBOARD_PERIOD=5s K6_WEB_DASHBOARD_OPEN=false \
  npm run test:dashboard -- load-roles
# Export only, suitable for CI with no live HTTP server:
K6_WEB_DASHBOARD_PORT=-1 npm run test:load:5
# Disable dashboard visualization and export while retaining PDF/HTML reports:
K6_WEB_DASHBOARD=false npm run test:load:5
# Native arrival-rate usage (load environment and JOURNEY_* settings first):
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_OPEN=true \
  k6 run k6/scenarios/load-arrival-rate.js
```

`K6_WEB_DASHBOARD_EXPORT` overrides the exported HTML path. Use a different port for concurrent live runs. The dashboard URL is available only while k6 is running; open the saved `k6-dashboard.html` afterward for the built-in report.

An explicit `--dashboard` flag enables visualization even when `K6_WEB_DASHBOARD=false`. Otherwise, an explicit `K6_WEB_DASHBOARD` setting overrides the automatic load-scenario default. Direct `k6 run` still requires the native dashboard variables shown above.

## Report completion and validation

The runner prints the PDF path and preserves nonzero k6 exit codes. Setup/initialization failures still produce an incomplete report when the runner can finish; missing metrics are shown as N/A. Hard termination of the runner (SIGKILL), disk failure or missing Node dependencies can prevent report generation. Console diagnostics remain in the terminal and are not embedded in stakeholder reports.

Reports aggregate the entire execution, including setup and ramps. They do not prove steady-state-only performance or a breaking point. Use server metrics and k6 time-series output separately for saturation/recovery analysis. Do not override the load schedule through `K6_*` environment settings when comparing the documented profiles; edit the shared profile configuration deliberately. The runner uses the legacy `handleSummary` schema explicitly for consistent report parsing.

Validate the tooling offline, without API traffic:

```bash
npm run test:reporting
```

This creates clearly named `report-selftest-*` synthetic example reports under ignored `results/`. They are not application performance results.

## Account verification and controlled arrival rate

Verify all 42 accounts without creating business records:

```bash
node --env-file=.env.prod k6/reporting/run.mjs login-all-users
```

Verification uses one VU and 42 sequential iterations. Configure `LOGIN_DELAY_SECONDS`, `LOGIN_MAX_RETRIES`, `LOGIN_MAX_RETRY_WAIT_SECONDS`, and `LOGIN_MAX_DURATION` explicitly in the selected environment file. The same login pacing and retry settings apply to load-test authentication; configure `LOGIN_SETUP_TIMEOUT` for load-test setup. This verifies accounts sequentially; it does not model concurrent real-world user arrivals. HTTP 429 responses respect `Retry-After` seconds or HTTP dates, with an exponential cooldown starting at `LOGIN_RETRY_BASE_SECONDS` (30 seconds when unset) when the header is absent. If the server asks for a longer wait, the account fails rather than retrying early. Retries are bounded; non-429 failures are not retried. Final authentication checks determine pass/fail, while every HTTP attempt, including 429s, remains in the metrics. Passwords and tokens are not logged.

Run business journeys at a fixed arrival rate:

```bash
JOURNEY_RATE=5 JOURNEY_TIME_UNIT=1m JOURNEY_DURATION=5m JOURNEY_VUS=20 \
  node --env-file=.env.prod k6/reporting/run.mjs load-arrival-rate
```

Set `JOURNEY_RATE`, `JOURNEY_TIME_UNIT`, `JOURNEY_DURATION`, and `JOURNEY_VUS` explicitly for each arrival-rate run. These are journey starts, not HTTP requests: a journey makes many requests. `JOURNEY_VUS` accepts 1–20 to avoid assigning concurrent VUs the same merchandiser/inventory account. VU assignment is stable, but the executor does not guarantee that every VU participates. There is no end-of-iteration think-time sleep in this scenario; the executor schedules arrivals. If all VUs are busy, dropped iterations fail the test rather than silently reducing the target. Choose the arrival rate from the intended workload and measured journey duration.

Authentication runs before the timed workload and aborts setup on any failed account. Sessions remain in setup data for that run; the separate verification run does not persist or transfer tokens. Business HTTP latency/error thresholds are scoped to the business scenario, excluding authentication. Aggregate report totals still include setup requests. Business failures, including 429 or expired sessions, are reported without automatic backoff or re-login. Independent role-based load uses its own account assignment, randomized think time, and session renewal as documented in the role-based guide.
