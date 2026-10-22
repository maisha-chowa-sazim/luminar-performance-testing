# Mission

## Purpose

Measure how Luminar Slice 1 performs at 5, 10, 20, 50, and 100 concurrent users. Compare response times, errors, throughput, and verified business completion against the project's expectations, and give developers evidence they can use to investigate and improve the application.

The purpose is to characterize behavior at each load level. A threshold failure is a useful result that requires investigation; thresholds must not be relaxed merely to produce a passing report.

## Audience and ownership

- QA engineers run, maintain, and extend the tests and prepare reproducible results.
- Developers use endpoint and workflow findings to investigate defects and performance problems.
- DevOps uses environment context and available infrastructure evidence to support diagnosis.
- Product and client stakeholders consume clear results describing tested loads, business outcomes, and limitations.

The tested business personas are Merchandiser and Inventory. Senior Merchandiser supports work-order approval and supplier handoff using a shared supporting account; this does not add a separately scheduled business VU.

## Slice 1 scope

Merchandiser creates a style, tech pack and uploads, sample, BOM, pre-costing, purchase order, and work order. Senior Merchandiser approves the work order and transitions it to `SENT_TO_SUPPLIER`. Inventory receives the order's items and verifies the persisted GRN, quantities, work-order status, and receipt uniqueness.

Merchandiser and Inventory run independently, with a durable handoff between them. BOM, costing, and purchase-order approvals/submissions, QC inspections, and stock-entry creation are outside the current workload. Wider roles and future slices require explicit scope changes.

## Performance expectations

The stakeholder expectation is a maximum two-second request/response time for regular application requests, with a separate allowance for tech-pack operations. This is a project expectation, not a universal industry standard.

The current automated gates differ from that literal maximum:

| Measure | Current independent-role gate |
| --- | --- |
| Regular API HTTP duration | p95 < 2 seconds; p99 < 2 seconds |
| Tech-pack upload URL, file transfer, and creation HTTP duration | p95 < 30 seconds; p99 < 45 seconds |
| Application HTTP failure rate | < 1% |
| Verified end-to-end completion / all started producer workflows | >= 99% |
| Activity | At least one producer attempt and one verified receipt |
| Incorrect quantities, duplicate successful receipts, data-integrity violations, coordination errors | Zero |

Percentile gates allow some requests above two seconds. Reports must make that difference clear and show endpoint maximum durations where available. Before treating two seconds as an automated hard maximum, define the intended request timing metric and deliberately update the configuration and reporting. The tech-pack budgets and error/completion gates above are existing defaults, not newly agreed stakeholder requirements. A tech-pack request budget is not a budget for the entire multi-file workflow.

HTTP duration, complete business-operation duration, and journey elapsed time are different measurements. Application analysis must exclude coordinator traffic and separate authentication setup; aggregate report/dashboard totals may include them. Aggregate execution metrics include ramps and drain and do not establish steady-state-only performance.

## Evidence and working principles

1. Validate functional behavior before interpreting load measurements. A fast rejection is not a successful business operation.
2. Use dedicated accounts and a disposable, seeded QA environment. Preserve run ledgers and reconcile ambiguous writes; never automatically replay create or receive requests.
3. Compare runs with equivalent environment, deployment, fixtures, account allocation, pacing, and schedules. Record differences that affect interpretation.
4. Preserve failures, incomplete outcomes, and runner exit codes. Keep credentials, tokens, signed URLs, and raw response bodies out of shared results.
5. Distinguish tooling checks, actual QA measurements, and planned capabilities. Do not claim a bottleneck or production capacity without supporting evidence.

Slice 1 measurement is complete when all five requested load levels have actual results or an explicit blocker, with reproducible configuration, endpoint latency/error findings, verified business outcomes, and actionable findings for developers. A blocked level remains outstanding; a synthetic tooling test does not complete it. The role suite now supports all five levels up to 100 VUs through named scenario files. The 100-user measurement still requires sufficient provisioned accounts and actual QA execution.

## Sources and maintenance

This constitution reflects the stakeholder interview on October 22, 2026, the [root README](../README.md), the [role-based guide](../docs/role-based-load-testing.md), and the current implementation. The [tech stack](tech-stack.md) records capability gaps; the [roadmap](roadmap.md) orders the remaining work. Revise these documents when scope, accepted thresholds, or supported loads change.
