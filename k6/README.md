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

Example values:

```bash
BASE_URL=https://qa.luminar.sazimlabs.com
MERCHANDISER_EMAIL=<test-user-email>
MERCHANDISER_PASSWORD=<set-locally>

LUMINAR_FACTORY_ID=2f7e5d9a-3c1b-4e8f-9a6d-1b2c3d4e5f60
LUMINAR_ORGANIZATION_ID=0e3c4b48-c231-4252-9be7-aafb4a647d05
LUMINAR_BUYER_ID=6a8e1b95-8e8d-4fee-b7ed-93703577d6d9
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

Run these scenarios only against a disposable QA environment. Keep `BASE_URL`, factory, organization, buyer, and role accounts aligned to the same tenant. Before running, verify that the buyer and garment-size template in `style.json`, the measurable items in `bom.json`, and the measurable items, suppliers, purchase-order references, and variants in `work-order.json` exist and are active in that tenant. The tech-pack metadata filenames must match files under `data/techpack/`.

These scenarios create persistent records and upload objects. The API currently exposes style soft-delete and tech-pack deletion, but no complete delete workflow for BOMs, samples, costings, purchase orders, work orders, or GRNs. For a full reset, restore the disposable QA database to its approved seeded snapshot and clear the test tech-pack object prefix using the environment's object-storage cleanup/lifecycle process. Do not treat reruns as cleanup; without that reset, duplicate records and accumulated files are expected.

## Performance profiles

Each profile runs the full style → sample → tech pack/upload → BOM → costing → purchase order → approvals → work order → item receipt journey. VUs represent concurrent journeys using shared role accounts, not distinct users. A three-second pause follows every finished attempt; set `THINK_TIME_SECONDS` to adjust it.

The requested table has five load levels, all covered below. Durations **include** ramp-up and ramp-down. Graceful completion can add up to two minutes; it may also allow retiring VUs to finish during ramp-down.

| Command | VUs | Ramp up | Steady load | Ramp down | Scheduled total |
| --- | ---: | --- | --- | --- | --- |
| `npm run test:load:5` | 5 | 1 min | 3 min | 1 min | 5 min |
| `npm run test:load:10` | 10 | 2 min | 14 min | 2 min | 18 min |
| `npm run test:load:20` | 20 | 2 min | 6 min | 2 min | 10 min |
| `npm run test:load:50` | 50 | 2 min | 4 min | 2 min | 8 min |
| `npm run test:load:100` | 100 | 1 min | 3 min | 1 min | 5 min |

Configuration lives in `config/performance.js`; each scenario has its own entrypoint in `scenarios/load-<users>-users.js`. The default acceptance criteria are HTTP failures <1%, HTTP p95 <3000ms, p99 <5000ms, checks >99%, journey success >99%, and at least one started and successfully completed journey. These are **provisional SLOs**, not agreed business requirements. Stress profiles keep the same criteria to expose degradation.

Performance setup requires `BASE_URL`, `LUMINAR_FACTORY_ID`, `LUMINAR_ORGANIZATION_ID`, `LUMINAR_BUYER_ID`, plus `_EMAIL` and `_PASSWORD` for each of `MERCHANDISER`, `EXECUTIVE`, `SENIOR_MERCHANDISER` and `INVENTORY`. Use locally supplied credentials. Verify fixture IDs/dates and restore the disposable test dataset between runs; see [QA review](../docs/k6-qa-review.md).

## Automatic stakeholder PDF reports

Prerequisites: Node.js 22+ and k6 (validated with 2.2.0). Install pinned reporting dependencies with `npm ci`. No browser or cloud reporting service is required.

Use the Node/npm runner for **every run that needs a PDF**. It loads the root `.env` automatically; existing exported environment values take precedence. Plain `k6 run` does not invoke Node's PDF renderer.

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

To open k6's live web dashboard and export its standalone HTML report into the same run directory:

```bash
npm run test:dashboard -- load-5-users
```

Replace `load-5-users` with any scenario name under `scenarios/`. The dashboard opens at `http://localhost:5665`; close its browser tab when finished so k6 can exit and the regular PDF/HTML reports can complete. The dashboard can take over a minute to show graphs for very short tests.

The runner prints the PDF path and preserves nonzero k6 exit codes. Setup/initialization failures still produce an incomplete report when the runner can finish; missing metrics are shown as N/A. Hard termination of the runner (SIGKILL), disk failure or missing Node dependencies can prevent report generation. Console diagnostics remain in the terminal and are not embedded in stakeholder reports.

Reports aggregate the entire execution, including setup and ramps. They do not prove steady-state-only performance or a breaking point. Use server metrics and k6 time-series output separately for saturation/recovery analysis. Do not override the load schedule through `K6_*` environment settings when comparing the documented profiles; edit the shared profile configuration deliberately. The runner uses the legacy `handleSummary` schema explicitly for consistent report parsing.

Validate the tooling offline, without API traffic:

```bash
npm run test:reporting
```

This creates clearly named `report-selftest-*` synthetic example reports under ignored `results/`. They are not application performance results.
