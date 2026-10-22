# Tech stack

## Existing foundation

Retain the current JavaScript, Node.js, k6, and local HTML/JSON reporting foundation. No stack migration is required for this constitution.

| Component | Current role and constraint |
| --- | --- |
| JavaScript and ES modules | Reusable API flows, helpers, scenario orchestration, and Node tooling |
| Node.js 22+ and npm | Environment loading, k6 process lifecycle, local coordinator, report generation, and offline tests |
| k6 | API load generation, checks, thresholds, and built-in dashboard; repository documentation records validation with 2.2.0 |
| Local HTML/JSON artifacts | Shareable HTML report, metadata, aggregate summary when available, dashboard HTML for enabled runs, and role-handoff ledger |
| Node loopback coordinator | Atomic single-consumer claims and durable per-run ledger; supports one local runner and its k6 process |
| JSON fixtures and binary tech-pack files | Business payloads, tenant/master-data references, relative shipment-date rule, and upload assets |
| Local dotenv configuration | Credentials and environment-specific IDs; exported environment values take precedence over root `.env` |
| Node test runner and k6 inspection/synthetic runs | Offline verification of tooling, load constraints, coordination, integrity, and reporting; optional browser regression when a supported browser is available |

Use the npm/Node runner for independent-role execution because it owns the coordinator and reporting lifecycle. Plain `k6 run` does not provide that lifecycle or automatically load dotenv files.

## Code organization

- [`k6/config/`](../k6/config/): workload options, thresholds, and dashboard layout. `role-load.mjs` governs independent-role workloads; `performance.js` contains legacy journey settings.
- [`k6/helpers/`](../k6/helpers/): HTTP/authentication, account selection, session management, identifiers, date handling, and role runtime utilities.
- [`k6/flows/`](../k6/flows/): reusable business actions and chained journeys. Preserve created IDs and validate dependent operations.
- [`k6/scenarios/`](../k6/scenarios/): executable functional and load entrypoints. `load-roles.js` is the primary Slice 1 load scenario; the arrival-rate journey remains a separate workload model.
- [`k6/reporting/`](../k6/reporting/): runner, coordinator, result assessment, and HTML generation.
- [`k6/tests/`](../k6/tests/): offline tooling verification. `npm run test:reporting` does not establish live application performance.
- [`k6/data/`](../k6/data/): fixtures and uploads; ignored `k6/results/` contains generated run artifacts.

## Current think-time defaults

At `ROLE_THINK_SCALE=1`, login/session navigation, style, sample, BOM, costing, purchase-order creation, and Inventory discovery each pause for a randomized **0.5–2 seconds**. Tech-pack creation is followed by a **30–45 second** pause, additional to actual upload/HTTP time. These are accelerated-workload assumptions, not measured production behavior.

Per-action `ROLE_THINK_<ACTION>_MIN/MAX` settings override the ranges. The dedicated role smoke command disables human think time. Inter-account authentication pacing, rate-limit cooldowns, polling, and failure backoff are separate controls.

## Supported load and implementation gaps

Independent-role runs currently enforce a total cap of 50 VUs. Existing allocations are 4+1, 8+2, 16+4, and 40+10 Merchandiser/Inventory users for totals of 5, 10, 20, and 50. Business VUs require distinct selected identities; the supporting Senior Merchandiser session is shared.

The requested 100-user workload is planned. A legacy 100-user profile definition does not provide an executable, supported 100-user independent-role test. Supporting it requires coordinated changes to limits, allocation, account provisioning, runner validation, tests, and documentation. An 80+20 split would preserve the current ratio but is a proposal to validate during implementation.

The stakeholder two-second maximum and the current p95/p99 gates differ; see [mission](mission.md#performance-expectations). This constitution records that gap without changing executable thresholds.

Some historical documents describe removed scenarios, older account models, or PDF outputs. Available scenario files, `package.json`, current runner code, and the current role configuration establish executable behavior. The local OpenAPI snapshot can lag QA contracts; costing routes and fixture dependencies need environment verification.

## Slice 2 entry requirement: fixture/preflight validation

**Status: deferred implementation; configure and implement when Slice 2 starts.** This is the only additional tooling gap selected in the stakeholder interview. Existing configuration/account/date checks are partial preflight, not complete fixture or business-contract validation.

Before Slice 2 load tests, provide a reusable preflight that:

1. Validates the selected environment, tenant IDs, required variables, distinct role-account capacity, and scenario allocation without exposing secrets.
2. Validates fixture structure, relative and fixed business dates, upload-file existence, and metadata/filename consistency locally.
3. Checks referenced buyer, templates, measurable items, suppliers, units, variants, permissions, and relevant API contracts against the selected QA environment using bounded read-only checks where supported.
4. Clearly distinguishes locally verified facts, live checks, and prerequisites that require manual confirmation. Live authentication/read checks must be deliberate; preflight must not create business records.
5. Stops load execution on failed prerequisites and provides a sanitized, actionable result identifying the fixture or configuration to fix.

Until implemented, QA follows the manual prerequisites in the [role-based guide](../docs/role-based-load-testing.md#credentials-and-prerequisites) and validates the business journey with smoke testing.

## Deferred infrastructure

Automated QA reset, CI integration, Grafana/InfluxDB integration, server telemetry setup, and additional workload types are not scheduled by this constitution. Manual QA data restoration remains necessary for comparable write-heavy runs. Existing Docker Compose definitions express an earlier tooling direction; they do not establish a working integrated reporting pipeline.

Results currently remain local. Distributed workers, coordinator restart/resume, and concurrent runs sharing accounts are unsupported. Revisit these constraints only when a later scope requires them.
