import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';

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
    const status = !summary || !requests ? 'INCOMPLETE' : metadata.exitCode !== 0 || failed.length ? 'FAIL' : thresholds.length ? 'PASS' : 'UNASSESSED';
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
            return `${tag.slice(6, -1)}: ${count} requests; p95 ${count ? number(timing['p(95)']) : 'N/A'} ms; errors ${count ? percent(values(`http_req_failed${tag}`).rate) : 'N/A'}`;
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
    return { status, sections };
}

export async function writeReports(directory, summary, metadata) {
    const model = reportModel(summary, metadata);
    const title = 'Luminar | Performance test report';
    await writeFile(`${directory}/report.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>${title}</title><style>body{font:15px/1.6 system-ui;max-width:1000px;margin:40px auto;color:#172b4d}h1{color:#123b59}h2{border-bottom:2px solid #dae5ed;padding-top:16px}li{margin:8px 0;overflow-wrap:anywhere}@media print{body{margin:0}h2{break-after:avoid}li{break-inside:avoid}}</style><h1>${title}</h1><p><strong>${model.status}</strong></p>${model.sections.map(([heading, lines]) => `<h2>${escape(heading)}</h2><ul>${lines.map(line => `<li>${escape(line)}</li>`).join('')}</ul>`).join('')}</html>`);
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: title, Author: 'Luminar QA' } });
    const stream = createWriteStream(`${directory}/report.pdf`);
    const finished = new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); doc.on('error', reject); });
    doc.pipe(stream);
    doc.fontSize(22).fillColor('#123b59').text(title).moveDown(0.5);
    doc.fontSize(15).fillColor(model.status === 'PASS' ? '#167348' : '#a43b23').text(model.status).moveDown();
    for (const [heading, lines] of model.sections) {
        if (doc.y > 690) doc.addPage();
        doc.fillColor('#123b59').font('Helvetica-Bold').fontSize(13).text(heading).moveDown(0.5);
        doc.fillColor('#243746').font('Helvetica').fontSize(10);
        for (const line of lines) doc.text(line, { paragraphGap: 7 });
        doc.moveDown();
    }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).fillColor('#64748b').text(`Luminar QA | ${metadata.scenario} | ${i + 1} / ${pages.count}`, 48, 805, { lineBreak: false });
    }
    doc.end();
    await finished;
    return model.status;
}
