# QA lead review: k6 setup

Reviewed 2026-09-29. Scope: project structure, fixtures, helpers, business flows, scenarios and reporting. Static review plus local k6/reporting validation; no live API load was executed. Existing uncommitted work was retained.

## Assessment

The separation into config, reusable helpers, business flows and scenario entrypoints is a sound foundation. Stable request `name` tags, business-response checks and chained resource IDs are useful. Previously, the scenario collection was primarily functional smoke coverage, not an established performance suite. The additions provide a repeatable load and report baseline, subject to the outstanding limitations below.

## Findings and disposition

| Priority | Finding / evidence | Impact and action |
| --- | --- | --- |
| High — addressed | Existing scenario options use one VU/iteration; `config/profiles.js` only supplies a single ramp with no ramp-down. | Added five independent `ramping-vus` profiles, explicit steady intervals, ramp-down and graceful completion. Legacy profile helpers are not used by these profiles. |
| High — addressed | Most existing scenarios gate only functional checks. | New profiles gate errors, p95/p99, checks, journey success and nonzero completed journeys. Targets are provisional and require stakeholder agreement; existing smoke semantics are retained. |
| High — addressed for load suite | `scenarios/full-journey.js` exits early on failed prerequisites; iteration count is not completed business transactions. | It now returns the final receipt check result. The performance wrapper tracks started/successful journeys, completion rate and duration, and paces both success and failure. |
| High — addressed | `flows/style.js`, `purchase-order.js`, `receive-item.js` used timestamp-only identifiers. | Added timestamp, global VU ID, per-VU sequence and random suffix to reduce collisions across concurrent runs. Validate any server-side field length restrictions with a smoke run. |
| High — open | `helpers/auth.js` loads one account per role. `setupAuth()` creates one merchandiser session for all VUs; other roles log in every journey. | This models concurrent workflows using shared identities. It does not model 100 distinct users. Provision per-VU account pools and agree login/session refresh behavior before making production-capacity claims. Repeated role logins may exercise authentication throttling. |
| High — open | Write-heavy flows create persistent styles, orders, receipts and uploaded objects; no complete teardown exists. | Restore an approved disposable QA seed snapshot and clean test object storage between comparable runs. Track created-data volume and do not run these loads against production. |
| High — open | `flows/purchase-order.js` hardcodes shipment date `2026-09-28`; fixtures contain dated sample and work-order fields. | Shipment date is already in the past on review day. Confirm business validation and use approved relative dates or maintained seeds. Tenant/supplier/template IDs must also match the environment. Invalid seed data would measure rejection paths. |
| Medium — partially addressed | Tenant/base URL defaults vary among `helpers/http.js`, `flows/style.js` and `flows/purchase-order.js`. | New performance setup requires explicit URL, tenant, buyer and all role credentials. Consolidate remaining functional-flow defaults and validate fixture dependencies in a future preflight step. |
| Medium — open | `helpers/auth.js` accepts a token from a cookie in a check but then unconditionally calls `resp.json()`. | A non-JSON cookie-only login response can still throw. Normalize response parsing before supporting that response contract. |
| Medium — open | Failure logs throughout flows/helpers include full response bodies. | These can contain sensitive data and add overhead during stress. Add opt-in sanitized diagnostics; keep raw terminal logs private. Generated stakeholder PDFs do not embed response bodies or credentials. |
| Medium — partially addressed | Signed upload URLs and generated resource paths can create high-cardinality URL tags. | Performance profiles exclude the URL system tag and retain stable request names. Existing smoke scenarios retain their current options. |
| Medium — open | `flows/tech-pack.js` loads binary fixtures per VU and constructs multipart buffers. | At 100 VUs, load-generator CPU/RAM and upload bandwidth may become limiting. Monitor the generator as well as the application; do not discard bodies globally because flows need response IDs. |
| Medium — addressed / bounded | No shareable automated report workflow existed. | Added unique run directories, PDF/HTML, raw aggregate summary and metadata; failure status is preserved. Reports include endpoint aggregates for performance profiles, checks, thresholds and explicit measurement limitations. |
| Medium — open | Aggregate-only results cannot identify the exact saturation point or confirm ramp-down recovery. | Add time-series output/server telemetry for breaking-point investigation. A 100-VU stage observes stress at that level; it does not prove the maximum sustainable capacity. |
| Low — addressed | Root README described obsolete smoke coverage and claimed scenarios that did not exist. | Updated run guidance, prerequisites, profile durations, reports and review links. |

## Execution and acceptance guidance

1. Agree workload mix, SLOs, account/session model, environment sizing and seed data with the team. These profiles execute the entire create-to-receipt journey including uploads, not a production-derived read/write mix.
2. Run functional smoke/full-journey validation against a disposable environment before load. Resolve fixture dates, permissions and API validation errors first.
3. Execute 5, 10, 20, 50 and 100 VUs separately, restoring comparable data and allowing recovery between runs. Investigate failures before increasing load.
4. Observe server and generator CPU/RAM, database connections/locks, queues, authentication throttling and storage throughput alongside k6. Record deployment and infrastructure changes.
5. Review HTTP failures, tail latency and journey completion together. Report thresholds aggregate ramp/setup/steady traffic. Graceful time permits in-flight work to finish and can extend wall time and actual concurrency during ramp-down.
6. Keep the same acceptance targets during stress: a failed target is evidence, not a reason to relax it. Use telemetry to establish where degradation begins and whether recovery occurs.

## Validation performed

`npm run test:reporting` checks all five scenarios using `k6 inspect`, verifies load stages and completion gates, tests assessment handling, and executes real k6 with synthetic metrics for pass, threshold failure and setup failure. It checks PDF/HTML generation and exit-code preservation. The synthetic scenarios make no network requests and are removed afterward. Their generated reports are plumbing examples, not Luminar performance results.

Validated locally with k6 2.2.0 and Node 26.5.0. PDFKit is pinned in package.json/package-lock.json. No live API behavior or production capacity has been validated.

## References

- [Grafana: ramping VUs](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/ramping-vus/)
- [Grafana: graceful completion](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/graceful-stop/)
- [Grafana: thresholds and failed exit status](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
- [Grafana: custom end-of-test summary](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/)
