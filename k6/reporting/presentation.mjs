import { writeFile, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { testTypeLabel } from './test-type.mjs';

const esc = value => String(value ?? 'N/A').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'N/A';
const pct = n => Number.isFinite(n) ? `${fmt(n * 100)}%` : 'N/A';
const duration = n => Number.isFinite(n) ? `${fmt(n / 1000, 3)} s` : 'N/A';
// Human review complements measured evidence; it never changes acceptance results.
function reviewSections(m, esc, table) {
    const review = m.metadata.review || {};
    const rows = values => values.map(row => row.map(esc));
    const objective = review.objective || (m.role ? `Characterize Slice 1 at ${m.config.total} configured users and identify latency, failure, and receipt-integrity problems for developer action.` : `Evaluate scenario ${m.metadata.scenario || 'not recorded'} against its configured checks and thresholds.`);
    const type = testTypeLabel(m.metadata);
    const context = `<section><h2>Objectives, scope, and test type</h2>${table(['Field', 'Recorded context'], rows([
        ['Objective', objective], ['Test type executed', `${type}; configured-rule outcome: ${m.status}`],
        ['Scope', review.scope || (m.role ? 'Style, techpack/uploads, sample, BOM, costing, purchase order, work order, approval/supplier handoff, GRN and receipt verification.' : 'See scenario implementation.')],
        ['Throughput acceptance target', 'No RPS acceptance target is configured for the role workload. Observed RPS is descriptive.'],
    ]))}</section>`;
    return { context };
}
const ruleLabel = row => row.metric.includes('duration')
    ? row.rule.replace(/([<>]=?|==)([0-9.]+)/g, (_, comparator, value) => `${comparator}${fmt(Number(value) / 1000, 3)} s`)
    : row.rule;

function metricLabel(metric) {
    if (metric.startsWith('http_req_duration')) return metric.includes('techpack') ? 'Techpack response time' : 'API response time';
    if (metric.startsWith('http_req_failed')) return 'HTTP failure rate';
    return ({ e2e_success: 'Verified workflow completion', merchandiser_attempted: 'Workflows started', received_work_orders: 'Orders received and verified', incorrect_inventory_quantities: 'Incorrect received quantities', duplicate_successful_receipts: 'Duplicate receipts', data_integrity_violations: 'Data integrity', coordination_errors: 'Workflow coordination', checks: 'Functional checks', dropped_iterations: 'Unstarted scheduled journeys', journey_success: 'Journey success', journey_started: 'Journeys started', journey_completed: 'Journeys completed' })[metric] || metric;
}

function actionLabel(metric) {
    if (metric.includes('duration')) return 'Review slow endpoints and matching server traces; compare against a run with the same workload.';
    if (metric.includes('http_req_failed')) return 'Review failed operations and HTTP status categories; separate data/permission errors from backend failures.';
    if (metric.includes('quantit') || metric.includes('integrity') || metric.includes('duplicate')) return 'Reconcile affected orders and receipts before retrying any write.';
    return 'Review failed workflow steps, ledger evidence, and execution diagnostics.';
}

function observedLabel(row) {
    const percentile = row.rule.match(/^p\((\d+)\)/)?.[1];
    if (percentile) return duration(row.values?.[`p(${percentile})`]);
    if (row.rule.startsWith('rate')) return pct(row.values?.rate);
    if (row.rule.startsWith('count')) return fmt(row.values?.count, 0);
    return 'N/A';
}

export function presentationModel(summary, metadata, status) {
    const metrics = summary?.metrics || {}, v = key => metrics[key]?.values || {};
    const role = !!metadata.roleConfiguration, config = metadata.roleConfiguration || {}, handoff = metadata.roleHandoff || {};
    const apiMetric = metrics['http_req_duration{traffic:application,workload:api}'] ? 'http_req_duration{traffic:application,workload:api}' : 'http_req_duration{traffic:application}';
    const latency = v(role ? apiMetric : 'http_req_duration');
    const separateTechPack = !!metrics['http_req_duration{traffic:application,workload:techpack}'];
    const failures = v(role ? 'http_req_failed{traffic:application}' : 'http_req_failed').rate;
    const thresholds = Object.entries(metrics).flatMap(([metric, data]) => Object.entries(data.thresholds || {}).map(([rule, result]) => ({ metric, rule, ok: result.ok === true, values: data.values })));
    const endpoints = Object.keys(metrics).filter(key => key.startsWith('http_reqs{name:')).map(key => {
        const tag = key.slice('http_reqs'.length), count = v(key).count || 0;
        return { name: tag.slice(6, -1), count, rate: v(key).rate, timing: count ? v(`http_req_duration${tag}`) : {}, failure: count ? v(`http_req_failed${tag}`).rate : undefined };
    }).filter(row => row.count > 0).sort((a,b) => (b.timing['p(95)'] || 0) - (a.timing['p(95)'] || 0));
    const checks = [];
    const walk = group => { for (const check of group?.checks || []) checks.push(check); for (const child of group?.groups || []) walk(child); };
    walk(summary?.root_group);
    const completion = handoff.attempted ? handoff.received / handoff.attempted : undefined;
    const applicationRequests = v(role ? 'http_reqs{traffic:application}' : 'http_reqs');
    const apiRequests = v(role ? 'http_reqs{traffic:application,workload:api}' : 'http_reqs{workload:api}');
    const pacing = !role || !Number.isFinite(config.thinkScale) ? 'Not recorded' : config.thinkScale === 0 ? 'Human think time disabled' : `Human think time enabled (scale ${config.thinkScale})`;
    const functionalBroken = checks.some(check => check.fails > 0) || ['incorrect_inventory_quantities', 'data_integrity_violations', 'duplicate_successful_receipts', 'coordination_errors'].some(key => v(key).count > 0);
    const functional = role ? !Number.isFinite(completion) ? 'INCOMPLETE' : completion < config.completion || functionalBroken || (metadata.roleFailures || []).length ? 'FAIL' : 'PASS' : 'See checks';
    const cards = [
        [role ? 'Application p95' : 'HTTP p95', duration(latency['p(95)']), `About 95% of requests are this fast or faster.${role ? ` Target < ${duration(config.apiP95)}; regular API only.` : ''}`],
        [role ? 'Application p99' : 'HTTP p99', duration(latency['p(99)']), `About 99% of requests are this fast or faster.${role ? ` Target < ${duration(config.apiP99)}; regular API only.` : ''}`],
        ['Average response time', duration(latency.avg), role ? 'Mean regular API duration; excludes human pauses and techpack.' : 'Mean HTTP duration; excludes human pauses.'],
        ['Requests per second (RPS)', `${fmt(apiRequests.rate)} req/s`, 'Regular API requests per elapsed second; excludes techpack, setup, and coordinator requests. Whole-run rate; uploads and think time still affect elapsed time. N/A if not captured.'],
        ['HTTP failure rate', pct(failures), role ? `Failed application HTTP requests. Target < ${pct(config.httpFailure)}.` : 'Failed HTTP requests / all HTTP requests.'],
        role ? ['Workflow completion', pct(completion), `${handoff.received ?? 'N/A'} received and verified / ${handoff.attempted ?? 'N/A'} attempted; includes early failures.`] : ['Check success', pct(v('checks').rate), 'Passed assertions / all recorded functional assertions.'],
        ['Application requests measured', fmt(applicationRequests.count, 0), role ? 'Application requests only, including techpack; sample size behind the observed traffic rate.' : 'All measured HTTP requests.'],
        ['Configured virtual users', fmt(config.total, 0), role ? `${config.merchandiser} Merchandiser + ${config.inventory} Inventory; includes users thinking or waiting.` : 'See scenario configuration.'],
        role ? ['Unreceived backlog', fmt(handoff.pending, 0), 'Created orders without a verified receipt, including failed/claimed orders; excludes failures before order creation.'] : ['Completed iterations', fmt(v('iterations').count, 0), 'Script loops completed; not equivalent to successful business workflows.'],
    ];
    if (separateTechPack) {
        const timing = v('http_req_duration{traffic:application,workload:techpack}');
        cards.push(['Techpack p95', duration(timing['p(95)']), `95th-percentile upload/techpack request duration. Target < ${duration(config.techPackP95)}.`], ['Techpack p99', duration(timing['p(99)']), `99th-percentile upload/techpack request duration. Target < ${duration(config.techPackP99)}.`]);
    }
    const failed = thresholds.filter(row => !row.ok);
    const verdict = status === 'INCOMPLETE' ? 'Execution evidence is incomplete. No acceptance decision is available.' : functional === 'PASS' && failed.length && failed.every(row => /^http_req_duration|^http_req_failed/.test(row.metric)) ? 'Receiving completed successfully. Performance acceptance targets were missed.' : status === 'PASS' ? 'The configured acceptance targets passed for this workload.' : status === 'UNASSESSED' ? 'No evaluated acceptance targets are available.' : 'Review the failed targets and workflow evidence before increasing load.';
    const insights = [
        failed.length ? `${failed.length} of ${thresholds.length} acceptance rules failed. Failed rules appear first below.` : `${thresholds.length} acceptance rules evaluated.`,
        endpoints.length ? `Highest observed endpoint p95: ${endpoints[0].name} (${duration(endpoints[0].timing['p(95)'])}, ${endpoints[0].count} requests).` : 'No endpoint breakdown was captured.',
        role ? 'Receiving scope: GRN creation, quantity and relationship read-back, work-order receipt status, and exactly one GRN. Work-order approval and supplier status precede receiving.' : 'Functional checks and endpoint timings are shown separately from acceptance thresholds.',
        'Aggregate results include ramps and drain. Small sample counts limit percentile interpretation; this run does not establish production capacity.',
    ];
    const errorStatuses = [0, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504].map(status => ({ status, count: v(`http_reqs{traffic:application,status:${status}}`).count }));
    return { status, functional, cards, thresholds: thresholds.sort((a,b) => Number(a.ok)-Number(b.ok)), failed, endpoints, checks, latency, role, handoff, config, verdict, insights, metadata, separateTechPack, pacing, allTraffic: v('http_reqs'), observedVUs: v('vus').max, errorStatuses, applicationRequests, responseOutcomes: [true, false].map(expected => ({ expected, timing: v(`http_req_duration{traffic:application,expected_response:${expected}}`) })), receiptRate: v('received_work_orders').rate };
}

function table(headers, rows, empty = 'No recorded data') {
    return `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
}
function bars(rows, label) {
    const valid = rows.filter(row => Number.isFinite(row.value));
    if (!valid.length) return '<p class="muted">No timing samples available.</p>';
    const max = Math.max(...valid.map(row=>row.value), 1);
    return `<svg role="img" aria-label="${esc(label)}" viewBox="0 0 760 ${valid.length * 48 + 12}">${valid.map((row,i)=>`<text x="0" y="${i*48+23}" fill="#475569" font-size="13">${esc(row.label)}</text><rect x="250" y="${i*48+6}" width="${Math.max(1, row.value/max*350)}" height="26" rx="5" fill="${row.color || '#2563eb'}"/><text x="${258+row.value/max*350}" y="${i*48+24}" fill="#0f172a" font-size="12">${esc(duration(row.value))}</text>`).join('')}</svg>`;
}
export function renderHtml(m) {
    const { metadata: meta } = m;
    const badge = value => `<span class="badge ${value === 'PASS' ? 'pass' : value === 'FAIL' ? 'fail' : 'neutral'}">${esc(value)}</span>`;
    const review = reviewSections(m, esc, table);
    let environmentLabel = 'ENV';
    try {
        const hostname = new URL(meta.environment).hostname;
        if (hostname === 'app.luminarbd.com') environmentLabel = 'PROD ENV';
        else if (hostname.startsWith('qa.')) environmentLabel = 'QA ENV';
    } catch { /* Historical metadata may not include a URL. */ }
    const date = typeof meta.startedAt === 'string' ? meta.startedAt.slice(0, 10) : 'N/A';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luminar Slice 1 | ${esc(testTypeLabel(meta))} | Performance assessment</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#0f172a;font:14px/1.6 system-ui,-apple-system,sans-serif}main{max-width:1280px;margin:auto;padding:36px 28px 64px}header{background:#101f36;color:white;border-radius:18px;padding:32px;margin-bottom:24px}header p{color:#cbd5e1;margin:8px 0}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7dd3fc}h1{font-size:32px;letter-spacing:-1px;margin:8px 0}h2{font-size:19px;margin:0 0 16px}h3{font-size:14px;margin:0 0 8px}.verdict{font-size:18px;color:white!important;max-width:850px}a{color:#2563eb}header a{color:#bae6fd}.badge{display:inline-block;font-size:11px;font-weight:750;letter-spacing:.5px;border-radius:6px;padding:4px 9px}.pass{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}.neutral{background:#e2e8f0;color:#334155}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}.card,section{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:22px}.card .label{font-size:12px;color:#475569}.card .value{font-size:27px;font-weight:750;margin:7px 0;letter-spacing:-.7px}.hint,.muted{font-size:12px;color:#64748b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.grid section{min-width:0}section{margin-bottom:20px}svg{display:block;width:100%;height:auto}table{width:100%;border-collapse:collapse;font-size:12px;text-align:left;font-variant-numeric:tabular-nums}th{background:#f8fafc;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.5px}td,th{padding:11px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top}td:first-child{overflow-wrap:anywhere}tr:last-child td{border-bottom:0}.table-scroll{overflow-x:auto}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.fact{padding:14px;background:#f8fafc;border-radius:8px}.fact strong{display:block;font-size:24px}.insights{display:grid;gap:12px}.insight{border-left:3px solid #38bdf8;padding-left:14px}.actions{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px}footer{color:#64748b;font-size:12px}@media(max-width:800px){main{padding:16px}.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.facts{grid-template-columns:repeat(2,1fr)}h1{font-size:26px}}@media print{body{background:white}main{padding:0}header{print-color-adjust:exact}section,.card{break-inside:avoid}.actions{display:none}}
</style></head><body><main><header><div class="eyebrow">Luminar ERP · Performance assessment</div><h1>Luminar Slice 1 - ${esc(testTypeLabel(meta))}</h1><p>Date: ${esc(date)}</p><p>${esc(environmentLabel)}: ${esc(meta.environment)}</p><p>Overall <strong>${esc(m.status)}</strong> &nbsp; ${badge(m.status)} &nbsp; Functional ${badge(m.functional)}</p></header>
<div class="cards">${m.cards.filter((card,index)=>index<6 || card[0].startsWith('Techpack')).map(([label,value,hint])=>`<div class="card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint)}</div></div>`).join('')}</div>
${review.context}
<section><h2>VU distribution</h2><p class="muted">Configured concurrent VUs by role; these are allocation targets, not measured active-user counts.</p>${m.role ? table(['Role', 'Configured VUs', 'Share'], [
    ['Merchandiser', fmt(m.config.merchandiser, 0), pct(m.config.merchandiser / m.config.total)],
    ['Inventory', fmt(m.config.inventory, 0), pct(m.config.inventory / m.config.total)],
    ['Total', fmt(m.config.total, 0), '100%'],
]) : '<p class="muted">Separate Merchandiser and Inventory VU allocation is not configured for this scenario.</p>'}</section>
<div class="grid"><section><h2>Response-time distribution</h2><p class="muted">${m.role ? `Application API traffic; coordinator and setup authentication excluded.${m.separateTechPack ? ' Techpack requests use separate targets.' : ''}` : 'All HTTP traffic.'} Whole-run percentiles, not a time series.</p>${bars(['med','p(90)','p(95)','p(99)','max'].map((key,i)=>({label:['Median','p90','p95','p99','Maximum'][i],value:m.latency[key],color:i>1?'#ea580c':'#2563eb'})), 'Response time percentiles')}</section><section><h2>QA findings</h2><div class="insights">${m.insights.map(text=>`<div class="insight">${esc(text)}</div>`).join('')}</div>${meta.error ? `<p class="fail">${esc(meta.error)}</p>` : ''}</section></div>
<section><h2>Slowest endpoints</h2><p class="muted">Observed p95 across at most eight slowest named operations. Endpoint metrics can include setup and upload operations; small samples are not reliable tail estimates.</p>${bars(m.endpoints.slice(0,8).map(row=>({label:row.name,value:row.timing['p(95)']})), 'Slowest endpoint p95')}</section>
<section><h2>Acceptance gates</h2><p class="muted">${m.thresholds.length - m.failed.length} passed · ${m.failed.length} failed. A gate is a configured pass/fail rule. Exact metric expressions are listed below.</p>${m.failed.length ? table(['Result','Measured area','Observed','Acceptance rule','Action'],m.failed.map(row=>[badge('FAIL'),esc(metricLabel(row.metric)),esc(observedLabel(row)),esc(ruleLabel(row)),esc(actionLabel(row.metric))])) : '<p>No failed acceptance rules recorded.</p>'}<h3>All acceptance rules (${m.thresholds.length})</h3>${table(['Result','Metric','Acceptance rule'],m.thresholds.map(row=>[badge(row.ok?'PASS':'FAIL'),esc(row.metric),esc(ruleLabel(row))]),'No evaluated acceptance targets.')}</section>
<section><h2>Endpoint evidence</h2><p class="muted">Requests = sample count; Req/s = whole-run requests per elapsed second for this operation; Avg = mean duration; p50 = median duration; p95/p99 = tail durations; Maximum = slowest request; Errors = failed HTTP percentage. Durations exclude human pauses. Endpoint-specific latency gates are not configured; current API and techpack latency gates pool requests within each category.</p>${table(['Operation','Requests','Req/s','Avg','p50','p95','p99','Maximum','Errors'],m.endpoints.map(row=>[esc(row.name),fmt(row.count,0),fmt(row.rate),duration(row.timing.avg),duration(row.timing.med),duration(row.timing['p(95)']),duration(row.timing['p(99)']),duration(row.timing.max),pct(row.failure)]))}</section>
<section><h2>Errors and response outcomes</h2><p class="muted">Selected application status counts, not a complete status histogram. HTTP 429 means throttling; it does not establish backend saturation. Status 0 indicates no HTTP response. Missing counters are N/A, not zero. Error onset and rate-limit scope require request logs/time-series evidence.</p>${table(['HTTP status','Requests','Share of application requests'],m.errorStatuses.map(row=>[String(row.status),fmt(row.count,0),Number.isFinite(row.count) && m.applicationRequests.count > 0 ? pct(row.count/m.applicationRequests.count) : 'N/A']))}${table(['HTTP response outcome','Avg','p95','p99'],m.responseOutcomes.map(row=>[row.expected?'Expected HTTP response':'Unexpected/failed HTTP response',duration(row.timing.avg),duration(row.timing['p(95)']),duration(row.timing['p(99)'])]))}<p class="muted">Outcome timings pool application API and techpack requests. HTTP outcome is not the same as business correctness. Verified receipt throughput: ${fmt(m.receiptRate)} workflows/s (whole-run rate, includes pacing; N/A when not captured).</p></section>

${meta.roleFailures?.length ? `<section><h2>Workflow failures</h2>${table(['Step','Category','HTTP','Error code','Record'],meta.roleFailures.map(row=>[esc(row.step),esc(row.kind),esc(row.httpStatus),esc(row.errorCode),esc(row.id)]))}</section>` : ''}
</main></body></html>`;
}

export async function writePresentation(directory, summary, metadata, status) {
    let review;
    try {
        review = JSON.parse(await readFile(path.join(directory, 'review.json'), 'utf8'));
        if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('review.json must contain a review object');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const m=presentationModel(summary,review ? { ...metadata, review } : metadata,status);
    const dashboard=path.join(directory,'k6-dashboard.html'),native=path.join(directory,'k6-dashboard-native.html');
    let hasNative=false;
    try {
        const existing=await readFile(dashboard,'utf8');
        if(!existing.includes('QA performance assessment') && !existing.includes('<h1>Luminar Slice 1'))await copyFile(dashboard,native);
        await readFile(native);hasNative=true;
    } catch(error) {if(error.code!=='ENOENT')throw error;}
    const html=renderHtml(m);
    await writeFile(path.join(directory,'report.html'),html);
    if(hasNative)await writeFile(dashboard,html);
    return status;
}
