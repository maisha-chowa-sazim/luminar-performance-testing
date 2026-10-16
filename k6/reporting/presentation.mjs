import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { writeFile, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const esc = value => String(value ?? 'N/A').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'N/A';
const pct = n => Number.isFinite(n) ? `${fmt(n * 100)}%` : 'N/A';
const duration = n => Number.isFinite(n) ? `${fmt(n / 1000, 3)} s` : 'N/A';

const ruleLabel = row => row.metric.includes('duration')
    ? row.rule.replace(/([<>]=?|==)([0-9.]+)/g, (_, comparator, value) => `${comparator}${fmt(Number(value) / 1000, 3)} s`)
    : row.rule;

export function presentationModel(summary, metadata, status) {
    const metrics = summary?.metrics || {}, v = key => metrics[key]?.values || {};
    const role = !!metadata.roleConfiguration, config = metadata.roleConfiguration || {}, handoff = metadata.roleHandoff || {};
    const latency = v(role ? 'http_req_duration{traffic:application}' : 'http_req_duration');
    const failures = v(role ? 'http_req_failed{traffic:application}' : 'http_req_failed').rate;
    const thresholds = Object.entries(metrics).flatMap(([metric, data]) => Object.entries(data.thresholds || {}).map(([rule, result]) => ({ metric, rule, ok: result.ok === true })));
    const endpoints = Object.keys(metrics).filter(key => key.startsWith('http_reqs{name:')).map(key => {
        const tag = key.slice('http_reqs'.length), count = v(key).count || 0;
        return { name: tag.slice(6, -1), count, rate: v(key).rate, timing: count ? v(`http_req_duration${tag}`) : {}, failure: count ? v(`http_req_failed${tag}`).rate : undefined };
    }).filter(row => row.count > 0).sort((a,b) => (b.timing['p(95)'] || 0) - (a.timing['p(95)'] || 0));
    const checks = [];
    const walk = group => { for (const check of group?.checks || []) checks.push(check); for (const child of group?.groups || []) walk(child); };
    walk(summary?.root_group);
    const completion = handoff.attempted ? handoff.received / handoff.attempted : undefined;
    const functionalBroken = checks.some(check => check.fails > 0) || ['incorrect_inventory_quantities', 'data_integrity_violations', 'duplicate_successful_receipts', 'coordination_errors'].some(key => v(key).count > 0);
    const functional = role ? !Number.isFinite(completion) ? 'INCOMPLETE' : completion < config.completion || functionalBroken || (metadata.roleFailures || []).length ? 'FAIL' : 'PASS' : 'See checks';
    const cards = [
        [role ? 'Application p95' : 'HTTP p95', duration(latency['p(95)']), role ? `Target < ${duration(config.apiP95)}` : '95th percentile'],
        [role ? 'Application p99' : 'HTTP p99', duration(latency['p(99)']), role ? `Target < ${duration(config.apiP99)}` : '99th percentile'],
        ['HTTP failure rate', pct(failures), role ? `Target < ${pct(config.httpFailure)}` : 'All HTTP traffic'],
        role ? ['Workflow completion', pct(completion), `${handoff.received ?? 'N/A'} received / ${handoff.attempted ?? 'N/A'} attempted`] : ['Check success', pct(v('checks').rate), 'Recorded functional checks'],
        ['Total HTTP requests', fmt(v('http_reqs').count, 0), 'Includes setup and local coordination'],
        ['Total request rate', `${fmt(v('http_reqs').rate)} /s`, 'Whole-run average, all traffic'],
        ['Concurrent users', fmt(config.total ?? v('vus').max, 0), role ? `${config.merchandiser} Merchandiser + ${config.inventory} Inventory` : 'Observed peak VUs'],
        role ? ['Unreceived backlog', fmt(handoff.pending, 0), 'Failed and claimed orders included'] : ['Completed iterations', fmt(v('iterations').count, 0), 'Not equivalent to business workflows'],
    ];
    const failed = thresholds.filter(row => !row.ok);
    const verdict = status === 'INCOMPLETE' ? 'Execution evidence is incomplete. No acceptance decision is available.' : functional === 'PASS' && failed.length ? 'Receiving completed successfully. Performance acceptance targets were missed.' : status === 'PASS' ? 'The configured acceptance targets passed for this workload.' : status === 'UNASSESSED' ? 'No evaluated acceptance targets are available.' : 'Review the failed targets and workflow evidence before increasing load.';
    const insights = [
        failed.length ? `${failed.length} of ${thresholds.length} acceptance rules failed. Failed rules appear first below.` : `${thresholds.length} acceptance rules evaluated.`,
        endpoints.length ? `Highest observed endpoint p95: ${endpoints[0].name} (${duration(endpoints[0].timing['p(95)'])}, ${endpoints[0].count} requests).` : 'No endpoint breakdown was captured.',
        role ? 'Receiving scope: GRN creation, quantity and relationship read-back, work-order receipt status, and exactly one GRN. QC and stock-entry creation are excluded.' : 'Functional checks and endpoint timings are shown separately from acceptance thresholds.',
        'Aggregate results include ramps and drain. Small sample counts limit percentile interpretation; this run does not establish production capacity.',
    ];
    return { status, functional, cards, thresholds: thresholds.sort((a,b) => Number(a.ok)-Number(b.ok)), failed, endpoints, checks, latency, role, handoff, config, verdict, insights, metadata };
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
export function renderHtml(m, nativeName) {
    const { metadata: meta } = m;
    const badge = value => `<span class="badge ${value === 'PASS' ? 'pass' : value === 'FAIL' ? 'fail' : 'neutral'}">${esc(value)}</span>`;
    const details = [['Run ID',meta.runId],['Scenario',meta.scenario],['Environment',meta.environment],['Started (UTC)',meta.startedAt],['Finished (UTC)',meta.finishedAt],['Wall duration',`${fmt(meta.wallSeconds)} s`],['Revision',meta.revision],['Engine',meta.k6Version],['Exit code',meta.exitCode],['Profile',meta.profile]];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luminar Slice 1 | Performance assessment</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#0f172a;font:14px/1.6 system-ui,-apple-system,sans-serif}main{max-width:1280px;margin:auto;padding:36px 28px 64px}header{background:#101f36;color:white;border-radius:18px;padding:32px;margin-bottom:24px}header p{color:#cbd5e1;margin:8px 0}.eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7dd3fc}h1{font-size:32px;letter-spacing:-1px;margin:8px 0}h2{font-size:19px;margin:0 0 16px}h3{font-size:14px;margin:0 0 8px}.verdict{font-size:18px;color:white!important;max-width:850px}a{color:#2563eb}header a{color:#bae6fd}.badge{display:inline-block;font-size:11px;font-weight:750;letter-spacing:.5px;border-radius:6px;padding:4px 9px}.pass{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}.neutral{background:#e2e8f0;color:#334155}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}.card,section{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:22px}.card .label{font-size:12px;color:#475569}.card .value{font-size:27px;font-weight:750;margin:7px 0;letter-spacing:-.7px}.hint,.muted{font-size:12px;color:#64748b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.grid section{min-width:0}section{margin-bottom:20px}svg{display:block;width:100%;height:auto}table{width:100%;border-collapse:collapse;font-size:12px;text-align:left;font-variant-numeric:tabular-nums}th{background:#f8fafc;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.5px}td,th{padding:11px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top}td:first-child{overflow-wrap:anywhere}tr:last-child td{border-bottom:0}.table-scroll{overflow-x:auto}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.fact{padding:14px;background:#f8fafc;border-radius:8px}.fact strong{display:block;font-size:24px}.insights{display:grid;gap:12px}.insight{border-left:3px solid #38bdf8;padding-left:14px}.actions{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px}details summary{cursor:pointer;font-weight:650;padding-bottom:12px}footer{color:#64748b;font-size:12px}@media(max-width:800px){main{padding:16px}.cards{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}.facts{grid-template-columns:repeat(2,1fr)}h1{font-size:26px}}@media print{body{background:white}main{padding:0}header{print-color-adjust:exact}section,.card{break-inside:avoid}.actions{display:none}details>*{display:block}}
</style></head><body><main><header><div class="eyebrow">Luminar ERP · QA performance assessment</div><h1>Luminar Slice 1</h1><p>${esc(meta.startedAt)} · ${esc(meta.environment)}</p><p class="verdict">${esc(m.verdict)}</p><p>Overall <strong>${esc(m.status)}</strong> &nbsp; ${badge(m.status)} &nbsp; Functional ${badge(m.functional)}</p><div class="actions"><a href="report.pdf">Download PDF</a>${nativeName ? `<a href="${esc(nativeName)}">Open original k6 time-series dashboard</a>` : ''}<a href="summary.json">Summary data</a>${m.role ? '<a href="handoff-ledger.json">Handoff ledger</a>' : ''}</div></header>
<div class="cards">${m.cards.map(([label,value,hint])=>`<div class="card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint)}</div></div>`).join('')}</div>
<div class="grid"><section><h2>Response-time distribution</h2><p class="muted">${m.role ? 'Application traffic; coordinator and setup authentication excluded.' : 'All HTTP traffic.'} Whole-run percentiles, not a time series.</p>${bars(['med','p(90)','p(95)','p(99)','max'].map((key,i)=>({label:['Median','p90','p95','p99','Maximum'][i],value:m.latency[key],color:i>1?'#ea580c':'#2563eb'})), 'Response time percentiles')}</section><section><h2>QA findings</h2><div class="insights">${m.insights.map(text=>`<div class="insight">${esc(text)}</div>`).join('')}</div>${meta.error ? `<p class="fail">${esc(meta.error)}</p>` : ''}</section></div>
${m.role ? `<section><h2>Workflow reconciliation</h2><div class="facts">${[['Attempted',m.handoff.attempted],['Work orders created',m.handoff.created],['Received & verified',m.handoff.received],['Failed orders',m.handoff.failed],['Unreceived backlog',m.handoff.pending],['Duplicate attempts',m.handoff.duplicateAttempts]].map(([name,n])=>`<div class="fact"><span>${esc(name)}</span><strong>${esc(fmt(n,0))}</strong></div>`).join('')}</div><p class="muted">Counts are reconciled from the run ledger. Created and received counts describe the same orders at different stages; they are not additive.</p></section>` : ''}
<section><h2>Slowest endpoints</h2><p class="muted">Observed p95 across at most eight slowest named operations. Endpoint metrics can include setup and upload operations; small samples are not reliable tail estimates.</p>${bars(m.endpoints.slice(0,8).map(row=>({label:row.name,value:row.timing['p(95)']})), 'Slowest endpoint p95')}</section>
<section><h2>Acceptance gates</h2><p class="muted">${m.thresholds.length - m.failed.length} passed · ${m.failed.length} failed</p>${m.failed.length ? table(['Result','Metric','Acceptance rule'],m.failed.map(row=>[badge('FAIL'),esc(row.metric),esc(ruleLabel(row))])) : '<p>No failed acceptance rules recorded.</p>'}<details><summary>All acceptance rules (${m.thresholds.length})</summary>${table(['Result','Metric','Acceptance rule'],m.thresholds.map(row=>[badge(row.ok?'PASS':'FAIL'),esc(row.metric),esc(ruleLabel(row))]),'No evaluated acceptance targets.')}</details></section>
<section><h2>Endpoint evidence</h2>${table(['Operation','Requests','Req/s','Average','p95','p99','Maximum','Errors'],m.endpoints.map(row=>[esc(row.name),fmt(row.count,0),fmt(row.rate),duration(row.timing.avg),duration(row.timing['p(95)']),duration(row.timing['p(99)']),duration(row.timing.max),pct(row.failure)]))}</section>
${meta.roleFailures?.length ? `<section><h2>Workflow failures</h2>${table(['Step','Category','HTTP','Error code','Record'],meta.roleFailures.map(row=>[esc(row.step),esc(row.kind),esc(row.httpStatus),esc(row.errorCode),esc(row.id)]))}</section>` : ''}
<section><details><summary>Functional check evidence (${m.checks.length})</summary>${table(['Check','Passed','Failed'],m.checks.map(row=>[esc(row.name),fmt(row.passes,0),fmt(row.fails,0)]))}</details></section>
<section><details><summary>Run configuration and provenance</summary>${table(['Field','Value'],details.map(([key,value])=>[esc(key),esc(value)]))}</details></section><footer>Generated from saved k6 summary and run metadata. Missing evidence is shown as N/A. No test was executed to render this report.</footer></main></body></html>`;
}

async function renderPdf(file, m) {
    const doc = new PDFDocument({ size:'A4', margin:40, bufferPages:true, info:{Title:'Luminar QA performance assessment',Author:'Luminar QA'} });
    const stream = createWriteStream(file), finished = new Promise((resolve,reject)=>{stream.on('finish',resolve);stream.on('error',reject);doc.on('error',reject);});doc.pipe(stream);
    const width = 515;
    const room = height => { if(doc.y+height>770)doc.addPage(); };
    const heading = text => {room(42);doc.moveDown(.7).font('Helvetica-Bold').fontSize(15).fillColor('#10223b').text(text);doc.moveDown(.5);};
    const text = value => {doc.font('Helvetica').fontSize(9).fillColor('#475569').text(String(value),{width,paragraphGap:7});};
    const rows = (headers, data, widths) => {
        const draw = (row, header=false) => {
            const heights=row.map((cell,i)=>doc.fontSize(8).heightOfString(String(cell),{width:widths[i]-12}));const height=Math.max(26,...heights.map(h=>h+14));
            if(doc.y+height>770){doc.addPage();if(!header)draw(headers,true);}
            const y=doc.y;doc.rect(40,y,width,height).fill(header?'#e8eef5':'#f8fafc');let x=40;
            row.forEach((cell,i)=>{doc.font(header?'Helvetica-Bold':'Helvetica').fontSize(8).fillColor('#243746').text(String(cell),x+6,y+7,{width:widths[i]-12});x+=widths[i];});doc.y=y+height+2;
        };
        draw(headers,true);for(const row of data)draw(row);
    };
    doc.rect(40,40,width,112).fill('#10223b');doc.fillColor('#7dd3fc').fontSize(9).text('LUMINAR ERP / QA PERFORMANCE ASSESSMENT',56,56);doc.fillColor('white').font('Helvetica-Bold').fontSize(22).text('Luminar Slice 1',56,77);doc.fontSize(11).text(`Overall: ${m.status}     Functional: ${m.functional}`,56,111);doc.y=167;text(m.verdict);
    const top=doc.y+10; m.cards.forEach(([label,value,hint],i)=>{const x=40+(i%2)*263,y=top+Math.floor(i/2)*79;doc.roundedRect(x,y,252,69,7).fill('#edf3f8');doc.font('Helvetica').fontSize(8).fillColor('#475569').text(label,x+12,y+9,{width:228});doc.font('Helvetica-Bold').fontSize(18).fillColor('#10223b').text(value,x+12,y+25,{width:228});doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(hint,x+12,y+49,{width:228});});doc.y=top+316;
    heading('QA findings');for(const insight of m.insights)text(insight);
    heading('Response-time distribution');
    const samples=['med','p(90)','p(95)','p(99)','max'].map(key=>({key,value:m.latency[key]})).filter(row=>Number.isFinite(row.value));const max=Math.max(1,...samples.map(row=>row.value));
    for(const row of samples){room(30);const y=doc.y;doc.fontSize(9).fillColor('#475569').text(row.key,40,y+5);doc.rect(100,y,Math.max(1,row.value/max*310),20).fill('#2563eb');doc.fontSize(8).fillColor('#10223b').text(duration(row.value),420,y+5,{width:135});doc.y=y+29;}
    if(!samples.length)text('No timing evidence available.');
    if(m.role){heading('Workflow reconciliation');rows(['Attempted','Created','Received','Failed','Backlog','Duplicates'],[[m.handoff.attempted,m.handoff.created,m.handoff.received,m.handoff.failed,m.handoff.pending,m.handoff.duplicateAttempts].map(n=>fmt(n,0))],[86,86,86,86,86,85]);}
    heading('Acceptance gates');text(`${m.thresholds.length - m.failed.length} passed / ${m.failed.length} failed. The HTML report includes every evaluated rule.`);if(m.failed.length)rows(['Result','Metric','Rule'],m.failed.map(row=>['FAIL',row.metric,ruleLabel(row)]),[48,337,130]);
    heading('Endpoint evidence');rows(['Operation','Count','Average s','p95 s','p99 s','Errors'],m.endpoints.map(row=>[row.name,fmt(row.count,0),fmt(row.timing.avg / 1000,3),fmt(row.timing['p(95)'] / 1000,3),fmt(row.timing['p(99)'] / 1000,3),pct(row.failure)]),[180,45,75,75,75,65]);
    if(m.metadata.roleFailures?.length){heading('Workflow failures');for(const row of m.metadata.roleFailures)text(`${row.step}: ${row.kind}; HTTP ${row.httpStatus}; ${row.id}`);}
    heading('Functional check evidence');rows(['Check','Passed','Failed'],m.checks.map(row=>[row.name,fmt(row.passes,0),fmt(row.fails,0)]),[395,60,60]);
    heading('Run provenance');for(const key of ['runId','environment','startedAt','finishedAt','revision','k6Version','profile','exitCode'])text(`${key}: ${m.metadata[key] ?? 'N/A'}`);
    const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.fontSize(8).fillColor('#64748b').text(`Luminar QA | Saved run assessment | ${i+1} / ${pages.count}`,40,800,{lineBreak:false});}doc.end();await finished;
}

export async function writePresentation(directory, summary, metadata, status) {
    const m=presentationModel(summary,metadata,status);
    const dashboard=path.join(directory,'k6-dashboard.html'),native=path.join(directory,'k6-dashboard-native.html');
    let hasNative=false;
    try {
        const existing=await readFile(dashboard,'utf8');
        if(!existing.includes('QA performance assessment'))await copyFile(dashboard,native);
        await readFile(native);hasNative=true;
    } catch(error) {if(error.code!=='ENOENT')throw error;}
    const html=renderHtml(m,hasNative?'k6-dashboard-native.html':null);
    await writeFile(path.join(directory,'report.html'),html);
    if(hasNative)await writeFile(dashboard,html);
    await renderPdf(path.join(directory,'report.pdf'),m);
    return status;
}
