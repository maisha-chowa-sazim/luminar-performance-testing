# Reporting requirements

The shareable HTML report follows stakeholder feedback and the [Gatling reporting guideline](https://gatling.io/blog/load-testing-report#10-common-mistakes), with the presentation simplified by the latest explicit stakeholder request.

## Visible content

Keep the title, run date/environment, overall and functional outcomes, and headline cards for regular API p95/p99, Avg, Requests per second (RPS), HTTP failures, workflow completion, and separate techpack p95/p99. Keep short descriptions beside these values.

The engineering evidence contains objectives/scope/test type, response-time distribution, QA findings, slowest endpoints, acceptance gates, endpoint evidence, error/response outcomes, bottleneck analysis, workflow failures when present.

Endpoint evidence retains request count, Req/s, Avg, p50, p95, p99, maximum, and errors. Failed gates show observed values, targets, and suggested investigations. All retained sections and acceptance rules are visible directly, without dropdowns.

## Removed by stakeholder request

Do not render these sections, including their content:

- Appendix: run configuration and provenance
- Functional check evidence
- Recommendations, owners, and retest
- Measurement validity and baseline
- Decision summary
- Environment and workload
- Supporting counts and load
- Load and measurement context
- Workflow reconciliation
- Metric definitions
- Threshold agreement row

Do not render the footer attribution/generation notice, the scope-exclusion sentence about other approvals/QC/stock entries, or the missing stakeholder sign-off sentence. Rename the request-rate card to **Requests per second (RPS)**.

Remove the title links for the original k6 dashboard, summary data, and handoff ledger. Preserve the underlying artifacts and functional checks; these presentation changes do not change test execution or acceptance.

## Interpretation

RPS is observed traffic per elapsed second, not simultaneous requests or maximum capacity. Application-scoped rates exclude setup/coordinator requests from the count. Human pauses affect RPS but not individual HTTP durations. Rates and percentiles describe the whole run, including ramps and drain. Do not infer no-pause throughput or steady-state capacity from aggregates. Historical metrics not captured must show N/A.

Keep Avg diagnostic alongside percentiles; show request sample counts and error rates, and never average percentiles across runs. A slow endpoint is an observation, not a confirmed root cause. Selected status counters include throttling (429); expected/unexpected response timings do not replace business checks.

Current human pauses at scale 1 are 0.5–2 seconds for login/session navigation and other listed business actions, with 30–45 seconds after techpack creation. Existing runs retain their original recorded measurements and thresholds.

## Optional analyst notes and regeneration

Copy [report-review.example.json](report-review.example.json) into the selected run directory as `review.json`. Visible analyst fields are `objective`, `testType`, `scope` and `findings`. Findings may contain `observation`, `evidence`, `impact`, `rootCause`, and `recommendation`. Fields for removed sections in an older review file are not rendered. Analyst notes cannot override the measured acceptance result.

```bash
npm run report:regenerate -- k6/results/<run-directory>
```

This updates saved HTML without executing a load test. Preserve the native dashboard, summary, metadata, and ledger as underlying evidence.

Regular API p95 and p99 now both target <2 seconds. Techpack budgets remain unchanged. An explicit `regularApiTargetMs` in a run’s `review.json` reassesses its report against that target without changing saved measurements, original thresholds, or exit status. The reassessment remains recorded in review.json; the Threshold agreement row is not displayed.
