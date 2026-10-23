import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { presentationModel, renderHtml } from '../reporting/presentation.mjs';
import { writeReports } from '../reporting/report.mjs';
import { runTestType, testType, testTypeSlug, testTypeLabel } from '../reporting/test-type.mjs';

test('workflow retains three columns and effective think times below VU distribution', () => {
    const meta = { ...metadata, roleConfiguration: { ...metadata.roleConfiguration, thinkScale: 1 },
        roleThinkRanges: { techpack: [30, 45], discover: [.5, 2] } };
    const html = renderHtml(presentationModel(summary, meta, 'FAIL'));
    const workflow = html.match(/<section><h2>Workflow and think time[\s\S]*?<\/section>/)[0];
    assert.match(workflow, /<th>Role<\/th><th>Workflow step<\/th><th>Think time<\/th>/);
    assert.doesNotMatch(workflow, /<th>Behaviou?r<\/th>/);
    assert.match(workflow, /30–45 s/);
    assert.match(workflow, /0.5–2 s/);
    assert.match(workflow, /new setting; not applied in this saved run/);
    assert.ok(html.indexOf('<h2>Workflow and think time') > html.indexOf('<h2>VU distribution'));
    assert.ok(html.indexOf('<h2>Workflow and think time') < html.indexOf('<h2>Response-time distribution'));
});

test('upload error evidence includes file, message, counts, and developer actions', () => {
    const html = renderHtml(presentationModel(summary, { ...metadata,
        uploadFailureSource: 'Terminal log',
        uploadFailures: [{ fileName: '<file>.psd', count: 3, httpStatus: 0, message: 'request timeout', errorCode: null }],
    }, 'FAIL'));
    assert.match(html, /Techpack upload errors/);
    assert.match(html, /&lt;file&gt;.psd/);
    assert.match(html, /request timeout/);
    assert.doesNotMatch(html, /Developer actions/);
    assert.match(html, /<span class="error-message">request timeout<\/span>/);
    assert.match(html, /\.error-message\{color:#b91c1c/);
    const future = renderHtml(presentationModel(summary, { ...metadata,
        roleFailures: [{ step: 'tech_pack_create', uploadFailure: { fileName: 'future.psd', httpStatus: 0, message: 'request timeout' } }],
    }, 'FAIL'));
    assert.match(future, /future.psd/);
    assert.match(future, /Techpack upload errors/);
});

const metadata = { scenario:'load-roles', exitCode:99, roleConfiguration:{total:2,merchandiser:1,inventory:1,completion:.99,apiP95:2000,apiP99:5000,httpFailure:.01},roleHandoff:{attempted:1,created:1,received:1,failed:0,pending:0,duplicateAttempts:0} };
const summary = { metrics: {
    http_reqs:{values:{count:100,rate:2}},
    'http_req_duration{traffic:application}':{values:{'p(95)':3000,'p(99)':6000},thresholds:{'p(95)<2000':{ok:false}}},
    http_req_duration:{values:{'p(95)':100}},
    'http_req_failed{traffic:application}':{values:{rate:0}},
    e2e_success:{values:{rate:1},thresholds:{'rate>=0.99':{ok:true}}},
},root_group:{checks:[{name:'synthetic <check>',passes:1,fails:0}]} };

test('test labels distinguish smoke and named loads in folders and report headers', () => {
    for (const [scenario, command, label, heading] of [
        ['smoke', 'test:smoke', 'smoke', 'Smoke Test : 2 VU'],
        ['load-roles', 'test:roles:smoke', 'roles:smoke', 'Smoke Test : 2 VU'],
        ['load-5-users', 'test:load:5', 'load:5', 'LoadTest : 5 VU'],
        ['load-10-users', 'test:load:10', 'load:10', 'LoadTest : 10 VU'],
    ]) {
        const type = runTestType(scenario, { npm_lifecycle_event: command });
        assert.equal(type, label);
        assert.equal(testTypeSlug(type), label.replaceAll(':', '-'));
        const html = renderHtml(presentationModel(summary, { ...metadata, scenario, testType: type }, 'FAIL'));
        assert.ok(html.includes(`<h1>Luminar Slice 1 - ${heading}</h1>`));
        assert.doesNotMatch(html, /Bottleneck analysis/);
    }
    assert.equal(testType({ scenario: 'load-10-users' }), 'load:10');
    assert.equal(testType({ scenario: 'load-roles', roleConfiguration: { maxWorkflowsPerVU: 1 } }), 'roles:smoke');
    assert.equal(runTestType('smoke', { npm_lifecycle_event: 'test:performance' }), 'smoke');
});

test('visual assessment separates successful receiving from failed application latency', () => {
    const model=presentationModel(summary,metadata,'FAIL');
    assert.equal(model.functional,'PASS');
    assert.equal(model.latency['p(95)'],3000);
    assert.equal(model.cards[0][1],'3 s');
    assert.equal(model.failed.length,1);
    assert.equal(model.thresholds[0].ok,false);
    const html=renderHtml(model);
    assert.doesNotMatch(html, /<p class="verdict">/);
    assert.match(html,/<h1>Luminar Slice 1 - LoadTest : 2 VU<\/h1>/);
    assert.doesNotMatch(html,/3,000 ms/);
    assert.match(html,/Response-time distribution/);
    assert.match(html,/<svg role="img"/);
    assert.match(html,/<table>/);
    assert.doesNotMatch(html,/Functional check evidence/);
    assert.doesNotMatch(html,/synthetic <check>/);
});
test('missing latency is N\/A and missing completion is incomplete, not a passing zero', () => {
    const model=presentationModel(null,{...metadata,roleHandoff:{}},'INCOMPLETE');
    assert.equal(model.cards[0][1],'N/A');
    assert.equal(model.functional,'INCOMPLETE');
    assert.match(renderHtml(model),/No timing samples available/);
});
test('saved report regeneration preserves native dashboard bytes and is repeatable', async () => {
    const directory=await mkdtemp(path.join(tmpdir(),'luminar-report-layout-'));
    try {
        const native='<!doctype html><title>Original k6 export</title><script>/* original payload */</script>';
        await writeFile(path.join(directory,'k6-dashboard.html'),native);
        for(let i=0;i<2;i++)assert.equal(await writeReports(directory,summary,metadata),'FAIL');
        assert.equal(await readFile(path.join(directory,'k6-dashboard-native.html'),'utf8'),native);
        const html=await readFile(path.join(directory,'k6-dashboard.html'),'utf8');
        assert.doesNotMatch(html,/Open original k6 time-series dashboard|Summary data|Handoff ledger/);
        assert.equal(html,await readFile(path.join(directory,'report.html'),'utf8'));
        assert.doesNotMatch(html,/report\.pdf|Download PDF/);
        assert.equal((await readdir(directory)).some(name=>name.endsWith('.pdf')),false);
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('reports separate regular API latency from techpack latency without changing historical gates', () => {
    const current=structuredClone(summary);
    current.metrics['http_req_duration{traffic:application,workload:api}']={values:{'p(95)':1500,'p(99)':4000}};
    current.metrics['http_req_duration{traffic:application,workload:techpack}']={values:{'p(95)':20000,'p(99)':25000}};
    const model=presentationModel(current,{...metadata,roleConfiguration:{...metadata.roleConfiguration,techPackP95:30000,techPackP99:45000}},'FAIL');
    assert.equal(model.cards[0][1],'1.5 s');
    assert.equal(model.cards.find(card=>card[0]==='Techpack p95')[1],'20 s');
    assert.match(model.cards.find(card=>card[0]==='Techpack p95')[2],/Target < 30 s/);
    assert.equal(summary.metrics['http_req_duration{traffic:application}'].thresholds['p(95)<2000'].ok,false);
});

test('headline throughput uses application scope and preserves unknown historical measurements', () => {
    const current=structuredClone(summary);
    current.metrics['http_reqs{traffic:application}']={values:{count:60,rate:1.2}};
    current.metrics['http_reqs{traffic:application,workload:api}']={values:{count:45,rate:0.9}};
    current.metrics['http_reqs{traffic:application,workload:techpack}']={values:{count:15,rate:0.3}};
    current.metrics['http_req_duration{traffic:application}'].values.avg=1800;
    const model=presentationModel(current,{...metadata,roleConfiguration:{...metadata.roleConfiguration,thinkScale:0}},'FAIL');
    assert.equal(model.cards.find(card=>card[0]==='Requests per second (RPS)')[1],'0.9 req/s');
    assert.equal(model.cards.find(card=>card[0]==='Application requests measured')[1],'60');
    assert.equal(model.cards.find(card=>card[0]==='Average response time')[1],'1.8 s');
    assert.equal(model.allTraffic.count,100);
    assert.equal(model.pacing,'Human think time disabled');
    const historical=presentationModel(summary,metadata,'FAIL');
    assert.equal(historical.cards.find(card=>card[0]==='Requests per second (RPS)')[1],'N/A req/s');
    assert.match(model.cards.find(card=>card[0]==='Requests per second (RPS)')[2], /excludes techpack, setup, and coordinator/);
    assert.equal(historical.pacing,'Not recorded');
    const html=renderHtml(model);
    assert.match(html,/About 95% of requests are this fast or faster/);
    assert.match(html,/API response time/);
    assert.match(html,/<td>3 s<\/td>/);
    assert.match(html,/Review slow endpoints/);
});

test('simplified template retains throttling evidence and removes requested sections and title links', () => {
    const current = structuredClone(summary);
    current.metrics.vus = { values: { max: 1 } };
    current.metrics['http_reqs{traffic:application}'] = { values: { count: 80, rate: 1.6 } };
    current.metrics['http_reqs{traffic:application,status:429}'] = { values: { count: 4 } };
    current.metrics['http_req_duration{traffic:application,expected_response:false}'] = { values: { avg: 20, 'p(95)':30 } };
    const html = renderHtml(presentationModel(current, metadata, 'FAIL'));
    assert.match(html,/<td>429<\/td><td>4<\/td><td>5%<\/td>/);
    assert.doesNotMatch(html,/Bottleneck analysis|No reviewed bottleneck analysis/);
    assert.match(html, /VU distribution/);
    assert.match(html, /<td>Merchandiser<\/td><td>1<\/td><td>50%<\/td>/);
    assert.doesNotMatch(html, /<\/?(?:details|summary)\b/);
    assert.match(html, /Requests per second \(RPS\)/);
    for (const removed of ['Appendix: run configuration and provenance', 'Functional check evidence', 'Recommendations, owners, and retest', 'Measurement validity and baseline', 'Decision summary', 'Environment and workload', 'Supporting counts and load', 'Load and measurement context', 'Open original k6 time-series dashboard', 'Summary data', 'Handoff ledger', 'Workflow reconciliation', 'Metric definitions', 'Other approvals, QC', 'Stakeholder sign-off is not recorded.', 'Generated from saved k6 summary', 'Application requests per second']) {
        assert.equal(html.includes(removed), false, removed);
    }
});

test('analyst review is escaped, optional, and cannot override measured acceptance', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'luminar-review-'));
    try {
        await writeFile(path.join(directory, 'review.json'), JSON.stringify({
            status: 'PASS', objective: '<script>example</script>', applicationBuild: 'qa-build-123',
            findings: [{ observation: 'Slow receipt', evidence: 'trace-123', impact: 'Delayed receipt', recommendation: 'Investigate database waits' }],
            actions: [{ priority: 'P1', action: 'Investigate', owner: 'Assigned developer', retestCriteria: 'Same seed and pacing' }],
        }));
        assert.equal(await writeReports(directory, summary, metadata), 'FAIL');
        const html = await readFile(path.join(directory, 'report.html'), 'utf8');
        assert.match(html,/Overall <strong>FAIL/);
        assert.match(html,/&lt;script&gt;example&lt;\/script&gt;/);
        assert.doesNotMatch(html,/<script>example/);
        assert.doesNotMatch(html,/qa-build-123/);
        assert.doesNotMatch(html,/Slow receipt|trace-123/);
        assert.doesNotMatch(html,/Assigned developer/);
        assert.equal(summary.metrics['http_req_duration{traffic:application}'].thresholds['p(95)<2000'].ok,false);
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('explicit revised response target reassesses the report without changing saved metrics', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'luminar-revised-target-'));
    try {
        const original = structuredClone(summary);
        delete original.metrics['http_req_duration{traffic:application}'].thresholds;
        original.metrics['http_req_duration{traffic:application,workload:api}'] = {
            values: { 'p(95)':1500, 'p(99)':3000 }, thresholds: { 'p(95)<2000':{ok:true}, 'p(99)<5000':{ok:true} },
        };
        await writeFile(path.join(directory, 'review.json'), JSON.stringify({ regularApiTargetMs:2000 }));
        assert.equal(await writeReports(directory, original, {...metadata,exitCode:0}), 'FAIL');
        const html = await readFile(path.join(directory, 'report.html'), 'utf8');
        assert.match(html,/p\(99\)&lt;2 s/);
        assert.equal(original.metrics['http_req_duration{traffic:application,workload:api}'].thresholds['p(99)<5000'].ok,true);
        assert.equal(metadata.roleConfiguration.apiP99,5000);
    } finally { await rm(directory,{recursive:true,force:true}); }
});


test('header shows date and production environment without the verdict sentence', () => {
    const html = renderHtml(presentationModel(summary, { ...metadata,
        testType: 'roles:smoke', startedAt: '2026-10-23T07:22:16.926Z', environment: 'https://app.luminarbd.com',
    }, 'FAIL'));
    assert.match(html, /<h1>Luminar Slice 1 - Smoke Test : 2 VU<\/h1>/);
    assert.match(html, /<p>Date: 2026-10-23<\/p>/);
    assert.match(html, /<p>PROD ENV: https:\/\/app.luminarbd.com<\/p>/);
    const header = html.match(/<header>[\s\S]*?<\/header>/)[0];
    assert.doesNotMatch(header, /Receiving completed successfully|Performance acceptance targets were missed/);
});


test('header duration uses measured k6 elapsed time and follows the title', () => {
    for (const [milliseconds, label] of [[2222437.475, '37m 2s'], [3661000, '1h 1m 1s'], [0, '0s'], [undefined, 'N/A']]) {
        const html = renderHtml(presentationModel({ ...summary, state: { testRunDurationMs: milliseconds } }, metadata, 'FAIL'));
        assert.ok(html.includes(`</h1><p>Duration: ${label}</p><p>Date:`));
    }
});
