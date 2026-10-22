# Roadmap

## Basis and scope

There is no `TODO.md` in this project, as confirmed by the stakeholder. This roadmap derives implementation order from the October 22, 2026 interview, current code, the [README](../README.md), and [role-based documentation](../docs/role-based-load-testing.md). It is the high-level planning reference until a task backlog exists.

The foundation is largely implemented. Remaining work should preserve reusable flows and truthful reporting while completing Slice 1 measurements at 5, 10, 20, 50, and 100 users. This roadmap does not authorize executing live tests or automatically escalating load.

## Phase 1 — Align Slice 1 expectations

**Status: constitution documented; executable acceptance alignment remains open.**

- Keep Merchandiser and Inventory as the load personas, with Senior Merchandiser supporting work-order approval and supplier transition.
- Resolve whether the two-second expectation becomes a hard maximum for a defined request timing metric or remains a percentile target. Retain and disclose current gates until deliberately changed; confirm the separate tech-pack allowance.
- Reconcile active run instructions with existing scenario entrypoints, the 100-VU role cap, and current HTML/JSON outputs.

**Exit:** the workload, timing metric, acceptance rules, and runnable instructions are explicit and consistent. Any changes to thresholds are recorded before subsequent comparisons.

## Phase 2 — Establish a trustworthy Slice 1 baseline

**Status: functional and reporting foundations implemented; current-revision QA verification remains required.**

- Manually verify environment, fixtures, dates, permissions, account capacity, and the retained costing contract using the existing prerequisites.
- Validate the current role journey at smoke scale in disposable QA. Check the ledger for one complete verified receipt, correct quantities, no duplicate receipt, no integrity errors, and no unexplained backlog.
- Measure the 5-user profile, recording endpoint duration/error results, workflow outcomes, run metadata, and any threshold failures.

**Exit:** functional correctness is established for the tested revision, and a reproducible 5-user result is available. Historical smoke success does not establish performance for a changed revision.

## Phase 3 — Measure existing supported load levels

**Status: 10-, 20-, and 50-user profiles implemented; measurements and findings remain to be established.**

- Run 10, then 20, then 50 users as separately selected tests after reviewing the preceding result and restoring comparable QA data through the existing environment process.
- Preserve documented role allocations, realistic pacing, and explicit schedules. Record changes to environment or deployment between runs.
- Give developers endpoint latency/error evidence and receipt-verified completion findings at each level. Investigate prerequisite failures before increasing load; retain genuine performance failures as results.

**Exit:** each supported level has an actual result and developer findings, with environment/configuration differences and any blocked measurement clearly identified.

## Phase 4 — Implement 100-user role-load support

**Status: 100-user scenario/configuration support implemented; account provisioning and live measurement remain outstanding.**

- Shared limits, named profiles, runner preflight, and offline checks now support 80 Merchandiser + 20 Inventory VUs. Provision those distinct QA identities before execution.
- Check coordinator behavior, handoff/drain behavior, session handling, upload resource use, and generator headroom at the new scale. Preserve atomic claims, no write replay, and receipt-integrity gates.
- Named files and commands now cover all five levels, with 10/15/20/15/10-minute steady periods. Verify the selected profile and do not bypass account/preflight checks.
- After implementation verification and lower-load review, measure 100 users as a separately selected QA run and deliver the same evidence as other levels.

**Exit:** 100 users are supported by configuration, accounts, runner, tests, and documentation, with an actual measured result or a clearly recorded remaining execution blocker. This level remains incomplete until measured.

## Phase 5 — Consolidate Slice 1 findings

**Status: follows the load measurements.**

- Compare all five levels using endpoint p95/p99/maximum durations, failures, throughput, verified completion, and integrity outcomes. Show tech-pack results separately and state how the two-second expectation was assessed.
- Distinguish application performance issues from fixture, contract, permission, coordination, or generator failures. Label suspected infrastructure causes as hypotheses when telemetry is absent.
- Give developers actionable findings with artifact links and reproduction context. After fixes, repeat the affected comparable profiles and preserve the original results.

**Exit:** stakeholders can see how Slice 1 behaved at each requested load and what needs developer action. The report must not claim unmeasured production capacity or imply that passing thresholds is required to finish characterization.

## Phase 6 — Slice 2 entry: configure fixture/preflight validation

**Status: explicitly deferred until Slice 2 starts; required before Slice 2 load measurements.**

- Configure Slice 2 environment, account requirements, fixtures, and relevant API dependencies.
- Implement the local validation and deliberate read-only QA checks specified in the [tech-stack entry requirement](tech-stack.md#slice-2-entry-requirement-fixturepreflight-validation).
- Verify that invalid fixtures/configuration stop execution with actionable diagnostics and that preflight creates no business records.

**Exit:** Slice 2 has an explicit preflight path and documented remaining manual prerequisites before write-heavy testing begins.

Automated data reset, CI, Grafana/InfluxDB, server telemetry integration, and new workload types remain deferred without a committed phase. No changes to the application suite or infrastructure are part of creating these constitution documents.
