# Luminar k6 project structure

This project follows the flow-based pattern used in the example k6 project:

- `config/` contains environment and scenario profiles
- `helpers/` contains shared auth and HTTP utilities
- `flows/` contains business-flow actions such as login, style, tech pack, BOM, costing, sample, PO, and work order
- `scenarios/` contains smoke, load, spike, breakpoint, and full-journey scripts

## Functional scenarios

Each functional scenario requires every k6 check to pass. The BOM, costing, sample, and tech-pack scenarios create a fresh style first. The receive-item scenario logs in as merchandiser, senior merchandiser, then inventory.

Run the scenarios independently:
```bash
k6 run k6/scenarios/login-all-users.js k6/reporting/run.mjs
k6 run k6/scenarios/sample-smoke.js
k6 run k6/scenarios/bom-smoke.js
k6 run k6/scenarios/pre-costing-smoke.js
k6 run k6/scenarios/tech-pack-smoke.js
k6 run k6/scenarios/style-to-pre-costing-flow.js
k6 run k6/scenarios/full-journey.js
k6 run k6/scenarios/work-order-and-receive-item-flow.js
```

## Environment variables

This project reads values from the workspace .env file and exposes them to k6 via `__ENV`.

Select QA or production explicitly in the command:

```bash
TEST_ENV=qa npm run test:roles:smoke
TEST_ENV=prod npm run test:roles:smoke
```

`TEST_ENV=qa` loads only `.env.qa` and uses `k6/data/bom.json` for the BOM.
`TEST_ENV=prod` loads only `.env.prod` and uses `k6/data/prod/bom.json`.
Without `TEST_ENV`, the runner keeps the existing `.env` and QA BOM behavior.
Set `TEST_ENV` in the command, not inside these files. Exported shell variables
override file values; use a fresh shell or unset previously exported tenant variables
when switching environments. Each environment file must contain its own base URL,
tenant IDs, garment-size-template ID, payment provider, and role credentials.
`k6/data/purchase.json` holds QA purchase-order data; production uses
`k6/data/prod/purchase.json`. Production brand and buyer-department IDs are
fixture-specific. Buyer and payment-provider IDs come from the environment,
PO numbers are unique, and shipment dates use today plus 30 days.
Production work orders use `k6/data/prod/work-order.json`; QA uses
`k6/data/work-order.json`. Both fixtures resolve item and supplier IDs from
`LUMINAR_MEASURABLE_ITEM_ID` and `LUMINAR_SUPPLIER_ID` in the selected
environment file (`.env.qa`, `.env.prod`, or the default `.env`).
A measurable item is a material/accessory, distinct from the garment-size template.
Reservation, purchase-order, style, color, and material
quantities are resolved from the current workflow. Production receipt fixtures use
`k6/data/prod/receive-item.json`; QA keeps `k6/data/recieve-item.json`.
The production full journey maps each receipt row to a newly created work-order
variant and uses the fixture partial quantities (400 M, 200 L). Role load tests
build receipts directly from API work-order data and receive the full quantities,
independently of receipt fixtures. Other data fixtures remain shared.
Style and combo IDs for BOM creation always come from the current workflow.

Example values:

```bash
BASE_URL=https://qa.luminar.sazimlabs.com
MERCHANDISER_EMAIL=<test-user-email>
MERCHANDISER_PASSWORD=<set-locally>

LUMINAR_FACTORY_ID=2f7e5d9a-3c1b-4e8f-9a6d-1b2c3d4e5f60
LUMINAR_ORGANIZATION_ID=0e3c4b48-c231-4252-9be7-aafb4a647d05
LUMINAR_BUYER_ID=6a8e1b95-8e8d-4fee-b7ed-93703577d6d9
LUMINAR_GARMENT_SIZE_TEMPLATE_ID=<garment-size-template-uuid-from-the-same-tenant>
LUMINAR_STYLE_ID=<existing-style-uuid>
```

Run with:

```bash
set -a
source .env
set +a
k6 run k6/scenarios/sample-smoke.js
```

## Seed data and cleanup

These scenarios create business records; use a disposable QA environment for routine runs. Keep `BASE_URL`, factory, organization, buyer, and role accounts aligned to the same tenant. Before running, verify the buyer and garment-size-template environment values, the measurable items in the selected BOM fixture, and the measurable items and suppliers in `work-order.json` exist and are active in that tenant. The tech-pack metadata filenames must match files under `data/techpack/`.

These scenarios create persistent records and upload objects. The API currently exposes style soft-delete and tech-pack deletion, but no complete delete workflow for BOMs, samples, costings, purchase orders, work orders, or GRNs. For a full reset, restore the disposable QA database to its approved seeded snapshot and clear the test tech-pack object prefix using the environment's object-storage cleanup/lifecycle process. Do not treat reruns as cleanup; without that reset, duplicate records and accumulated files are expected.

## Performance profiles

Each named profile runs independent Merchandiser/Inventory scenarios, with distinct business accounts and a shared Senior Merchandiser supporting approval account. The current workflow creates style → techpack/uploads → sample → BOM → costing → purchase order → work order → verified receipt. Human pauses use the role-based defaults, not the legacy journey sleep.

| Command | Entrypoint | Merchandiser + Inventory | Ramp up | Steady load | Producer ramp down |
| --- | --- | --- | --- | --- | --- |
| `npm run test:load:5` | `scenarios/load-5-users.js` | 4 + 1 | 2 min | 10 min | 2 min |
| `npm run test:load:10` | `scenarios/load-10-users.js` | 8 + 2 | 2 min | 15 min | 2 min |
| `npm run test:load:20` | `scenarios/load-20-users.js` | 16 + 4 | 2 min | 20 min | 2 min |
| `npm run test:load:50` | `scenarios/load-50-users.js` | 40 + 10 | 2 min | 15 min | 2 min |
| `npm run test:load:100` | `scenarios/load-100-users.js` | 80 + 20 | 2 min | 10 min | 2 min |

Requested durations are steady intervals, not total wall time. Producer grace (default 10m), Inventory drain (5m), its final ramp-down, setup authentication, and reporting extend execution. Named entrypoints pin their role allocation and steady period over dotenv values. Other `ROLE_*` controls remain configurable. Use `load-roles` for a fully custom schedule.

Configuration lives in `config/role-load.mjs`; lifecycle code is shared in `helpers/role-scenario.js`. Always run these through `node k6/reporting/run.mjs <scenario>` or npm, rather than plain `k6 run`, so the coordinator is available. The 100-VU cap includes the sum of both role peaks; it does not include the shared supporting account as another VU. All selected business identities must be distinct. Missing or insufficient credentials fail before business traffic.

Targets: regular API p95/p99 <2s; techpack p95 <30s / p99 <45s; application HTTP failures <1%; verified completion >=99%; nonzero attempted/received workflows; zero quantity, duplicate-success, integrity, or coordinator errors. Reported RPS uses `http_reqs{traffic:application,workload:api}` only. Techpack requests, setup, and coordination are excluded from the count; the elapsed-time denominator still includes uploads, thinking, ramps, and drain. Older summaries without this scoped counter show N/A.

Setup requires explicit tenant/base URL/payment-provider configuration, appropriate business-role pools and the Senior Merchandiser credential pair. Verify fixtures, dates, permissions, and the QA seed state before running. See the [role-based guide](../docs/role-based-load-testing.md).

## Automatic HTML reports

Prerequisites: Node.js 22+ and k6 (validated with 2.2.0). Install the project with `npm ci`. No browser or cloud reporting service is required.

Use the Node/npm runner for **every run that needs an HTML report**. It loads the root `.env` automatically; existing exported environment values take precedence. Plain `k6 run` does not invoke the HTML report generator.

```bash
npm ci
npm run test:smoke
npm run test:performance -- full-journey
npm run test:performance -- sample-smoke
npm run test:load:5
```

Every runner invocation creates `k6/results/<UTC timestamp>-<scenario>-<unique ID>/` containing:

- `report.html`: shareable report with assessment, environment/revision, profile, throughput, error rate, latency percentiles, journey completion, threshold results, endpoint breakdown (load profiles), functional checks and interpretation notes.
- `summary.json`: k6 aggregate metrics, when k6 reaches summary generation.
- `metadata.json`: scenario, UTC times, revision (including dirty-tree marker), engine version and exit status.

To open k6's live web dashboard and export its standalone HTML report into the same run directory:

The runner loads the native layout in `config/dashboard.json` to avoid a reproduced k6 2.2.0 white-screen crash when chart series appear after setup. HTTP graphs remain time series; late-arriving VU, iteration, transfer, and business metrics use stat panels. Restart the test and reload its dashboard to use the updated layout. See the [dashboard workaround and browser regression](../docs/role-based-load-testing.md#metrics-dashboard-and-reports).

```bash
npm run test:dashboard -- load-5-users
```

Replace `load-5-users` with any scenario name under `scenarios/`. The dashboard opens at `http://localhost:5665`; close its browser tab when finished so k6 can exit and the regular HTML reports can complete. The dashboard can take over a minute to show graphs for very short tests.

The runner prints the HTML report path and preserves nonzero k6 exit codes. Setup/initialization failures still produce an incomplete report when the runner can finish; missing metrics are shown as N/A. Hard termination of the runner (SIGKILL), disk failure or missing Node dependencies can prevent report generation. Console diagnostics remain in the terminal and are not embedded in stakeholder reports.

Reports aggregate the entire execution, including setup and ramps. They do not prove steady-state-only performance or a breaking point. Use server metrics and k6 time-series output separately for saturation/recovery analysis. Do not override the load schedule through `K6_*` environment settings when comparing the documented profiles; edit the shared profile configuration deliberately. The runner uses the legacy `handleSummary` schema explicitly for consistent report parsing.

Validate the tooling offline, without API traffic:

```bash
npm run test:reporting
```

This creates clearly named `report-selftest-*` synthetic example reports under ignored `results/`. They are not application performance results.

Regular application API latency targets are p95 < 2s and p99 < 2s. Techpack upload-URL generation, file transfer, and creation use separate provisional targets: p95 < 30s and p99 < 45s, configurable with `ROLE_TECHPACK_P95_MS` and `ROLE_TECHPACK_P99_MS`. Work-order approval and the supplier-status transition use the senior-merchandiser account before receiving. BOM, costing and purchase-order approvals/submissions remain excluded.

Work-order creation, approval/send-to-supplier, handoff, and receipt verification
each pause for 0.5–2 seconds by default. Override their ranges with
`ROLE_THINK_WORKORDER_MIN/MAX`, `ROLE_THINK_APPROVAL_MIN/MAX`,
`ROLE_THINK_HANDOFF_MIN/MAX`, and `ROLE_THINK_RECEIPT_MIN/MAX`
(use separate `_MIN` and `_MAX` variables). `ROLE_THINK_SCALE` scales all
pauses; smoke scripts set it to 0 to disable them.
