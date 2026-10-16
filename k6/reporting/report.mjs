import { writePresentation } from './presentation.mjs';

const number = value => Number.isFinite(value) ? value.toFixed(2) : 'N/A';
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'N/A';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function reportModel(summary, metadata) {
    const metrics = summary?.metrics || {};
    const values = key => metrics[key]?.values || {};
    const thresholds = Object.entries(metrics).flatMap(([name, metric]) =>
        Object.entries(metric.thresholds || {}).map(([rule, result]) => ({ name, rule, ok: result.ok === true })));
    const requests = values('http_reqs').count || 0;
    const failed = thresholds.filter(t => !t.ok);
    const roleIncomplete = metadata.roleConfiguration && (!metadata.roleHandoff?.attempted || !metrics.e2e_success);
    const roleFailed = metadata.roleConfiguration && (metadata.roleHandoff?.received / metadata.roleHandoff?.attempted < metadata.roleConfiguration.completion);
    const status = !summary || !requests || roleIncomplete ? 'INCOMPLETE' : metadata.exitCode !== 0 || failed.length || roleFailed ? 'FAIL' : thresholds.length ? 'PASS' : 'UNASSESSED';
    const checks = [];
    function walk(group) {
        for (const c of group?.checks || []) checks.push(`${c.name}: ${c.passes} passed / ${c.fails} failed`);
        for (const child of group?.groups || []) walk(child);
    }
    walk(summary?.root_group);
    const latency = values('http_req_duration');
    const sections = [
        ['Run details', [
            `Scenario: ${metadata.scenario}`, `Started (UTC): ${metadata.startedAt}`, `Finished (UTC): ${metadata.finishedAt}`,
            `Environment: ${metadata.environment}`, `Revision: ${metadata.revision}`, `Engine: ${metadata.k6Version}`,
            `k6 exit code: ${metadata.exitCode ?? 'not available'}; signal: ${metadata.signal || 'none'}`,
            `Measured test duration: ${number(summary?.state?.testRunDurationMs / 1000)} s`,
            `Wall time including startup/setup/report handoff: ${number(metadata.wallSeconds)} s`,
            `Profile: ${metadata.profile || 'Scenario-defined configuration'}`,
        ]],
        ['Executive assessment', [
            `Outcome: ${status}. ${failed.length} of ${thresholds.length} threshold rules failed.`,
            status === 'PASS' ? 'The configured thresholds passed for this workload. This is not a production capacity certification.' :
            status === 'FAIL' ? 'Investigate failed thresholds and execution errors before recommending release or higher load.' :
            'No performance acceptance decision is possible: missing request data or no evaluated thresholds.',
            ...(metadata.error ? [`Execution error: ${metadata.error}`] : []),
        ]],
        ['Key performance indicators', [
            `HTTP requests: ${requests}; throughput: ${number(values('http_reqs').rate)} requests/s`,
            `HTTP failure rate: ${percent(values('http_req_failed').rate)}`,
            `Response time (ms): average ${number(latency.avg)}; median ${number(latency.med)}; p95 ${number(latency['p(95)'])}; p99 ${number(latency['p(99)'])}; max ${number(latency.max)}`,
            `Check success rate: ${percent(values('checks').rate)}`,
            `Completed iterations: ${values('iterations').count ?? 'N/A'}; observed peak VUs: ${values('vus').max ?? 'N/A'}`,
            `Journeys started: ${values('journey_started').count ?? 'N/A'}; completed successfully: ${values('journey_completed').count ?? 'N/A'}`,
            `Journey success rate (finished attempts): ${percent(values('journey_success').rate)}`,
            `Journey duration p95: ${number(values('journey_duration')['p(95)'])} ms`,
        ]],
        ['Acceptance thresholds', thresholds.length ? thresholds.map(t => `${t.ok ? 'PASS' : 'FAIL'} | ${t.name} | ${t.rule}`) : ['No evaluated thresholds available.']],
        ['Endpoint breakdown', Object.keys(metrics).filter(key => key.startsWith('http_reqs{name:')).map(key => {
            const tag = key.slice('http_reqs'.length);
            const count = values(key).count || 0;
            const timing = values(`http_req_duration${tag}`);
            return `${tag.slice(6, -1)}: ${count} requests; ${number(values(key).rate)} requests/s; average ${count ? number(timing.avg) : 'N/A'}, p90 ${count ? number(timing['p(90)']) : 'N/A'}, p95 ${count ? number(timing['p(95)']) : 'N/A'}, p99 ${count ? number(timing['p(99)']) : 'N/A'} ms; errors ${count ? percent(values(`http_req_failed${tag}`).rate) : 'N/A'}`;
        })],
        ['Functional checks', checks.length ? checks : ['No check data available.']],
        ['Interpretation and next steps', [
            'Performance profiles use provisional targets: HTTP errors <1%, p95 <3000ms, p99 <5000ms, checks and completed-journey success >99%. Agree SLOs with stakeholders.',
            'Metrics aggregate the whole run, including ramps and setup. They are not steady-state-only measurements. VUs represent concurrent journeys, not requests per second or distinct accounts.',
            'Full-journey loads share role accounts; the merchandiser session is created in setup, and other roles log in during each journey. Upload traffic is included in HTTP totals.',
            'Forced interruption can leave unfinished journeys without a success sample. Compare started/completed counts and the local execution output. Missing metrics are N/A, never assumed zero latency.',
            'Correlate this run with server CPU, memory, database, queue and error telemetry. Compare against baseline under the same seed data and infrastructure; restore the test dataset between runs.',
            'No automatic breaking-point or recovery claim is made from an aggregate report. Use time-series telemetry for saturation, ramp-down recovery and endpoint diagnosis.',
        ]],
    ];
    if (metadata.roleConfiguration) {
        const config = metadata.roleConfiguration, handoff = metadata.roleHandoff || {};
        sections.splice(3, 0, ['Independent roles and handoff', [
            `Run identifier: ${metadata.runId}; ${config.merchandiser} Merchandiser + ${config.inventory} Inventory VUs (cap 50).`,
            `Workflows attempted: ${handoff.attempted ?? 'N/A'}; Merchandiser completed: ${values('merchandiser_completed').count ?? 0}; failed: ${values('merchandiser_failed').count ?? 0}; success: ${percent(values('merchandiser_success').rate)}.`,
            `Work orders created: ${handoff.created ?? 'N/A'}; ready: ${handoff.ready ?? 'N/A'}; currently claimed: ${handoff.claimed ?? 'N/A'}; received and verified: ${handoff.received ?? 'N/A'}; failed: ${handoff.failed ?? 'N/A'}; unreceived backlog (includes failed/claimed): ${handoff.pending ?? 'N/A'}.`,
            `End-to-end completion against ALL attempted workflows: ${handoff.attempted ? percent(handoff.received / handoff.attempted) : 'N/A'}; Inventory success: ${percent(values('inventory_success').rate)}; failed receiving attempts: ${values('inventory_failed').count ?? 0}.`,
            `End-to-end elapsed p95: ${number(values('e2e_elapsed_duration')['p(95)'])} ms; work-order creation to verified item receipt p95: ${number(values('work_order_to_receipt_duration')['p(95)'])} ms. Both include human delays and queue waiting. HTTP latency measures request time separately.`,
            `Quantity violations: ${values('incorrect_inventory_quantities').count ?? 'N/A'}; data-integrity violations: ${values('data_integrity_violations').count ?? 'N/A'}; duplicate successful receipts: ${values('duplicate_successful_receipts').count ?? 'N/A'}; coordinator duplicate acknowledgements: ${handoff.duplicateAttempts ?? 'N/A'}.`,
            `Application HTTP latency p95: ${number(values('http_req_duration{traffic:application}')['p(95)'])} ms; p99: ${number(values('http_req_duration{traffic:application}')['p(99)'])} ms; errors: ${percent(values('http_req_failed{traffic:application}').rate)}. Aggregate HTTP totals also include local coordination and setup.`,
            'handoff-ledger.json retains created, ready, claimed, failed, and received orders and workflow failures. Claims are never automatically reassigned. Failed/ambiguous writes require manual reconciliation before any retry.',
            'Receiving is verified through GRN and work-order quantity/status read-backs; QC and stock-entry operations are excluded. Only work-order approval and supplier status are required before receiving.',
            ...(metadata.roleFailures?.length ? metadata.roleFailures.map(value => `Failed record ${value.id}: step ${value.step}; category ${value.kind || 'unknown'}; HTTP ${value.httpStatus ?? 'not available'}.`) : ['No failed records recorded in the handoff ledger.']),
        ]]);
        const notes = sections.find(([heading]) => heading === 'Interpretation and next steps')[1];
        notes.splice(0, 3,
            `Provisional application API targets: p95 <${config.apiP95}ms, p99 <${config.apiP99}ms, failures <${percent(config.httpFailure)}; end-to-end completion >=${percent(config.completion)}.`,
            'Each business VU has a distinct account within its role and reuses its session. The two roles execute independently. Coordinator traffic is excluded from application HTTP thresholds.',
            'Role metrics include ramps and drain; they do not establish steady-state-only performance. Empty Inventory polls indicate lack of available work, not backend receipt failures. Failed API checks/steps, authentication failures, and data-integrity counters must be investigated separately.');
    }
    return { status, sections };
}

export async function writeReports(directory, summary, metadata) {
    return writePresentation(directory, summary, metadata, reportModel(summary, metadata).status);
}
