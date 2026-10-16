import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { presentationModel, renderHtml } from '../reporting/presentation.mjs';
import { writeReports } from '../reporting/report.mjs';

const metadata = { scenario:'load-roles', exitCode:99, roleConfiguration:{total:2,merchandiser:1,inventory:1,completion:.99,apiP95:2000,apiP99:5000,httpFailure:.01},roleHandoff:{attempted:1,created:1,received:1,failed:0,pending:0,duplicateAttempts:0} };
const summary = { metrics: {
    http_reqs:{values:{count:100,rate:2}},
    'http_req_duration{traffic:application}':{values:{'p(95)':3000,'p(99)':6000},thresholds:{'p(95)<2000':{ok:false}}},
    http_req_duration:{values:{'p(95)':100}},
    'http_req_failed{traffic:application}':{values:{rate:0}},
    e2e_success:{values:{rate:1},thresholds:{'rate>=0.99':{ok:true}}},
},root_group:{checks:[{name:'synthetic <check>',passes:1,fails:0}]} };

test('visual assessment separates successful receiving from failed application latency', () => {
    const model=presentationModel(summary,metadata,'FAIL');
    assert.equal(model.functional,'PASS');
    assert.equal(model.latency['p(95)'],3000);
    assert.equal(model.cards[0][1],'3 s');
    assert.equal(model.failed.length,1);
    assert.equal(model.thresholds[0].ok,false);
    const html=renderHtml(model);
    assert.match(html,/Receiving completed successfully/);
    assert.match(html,/<h1>Luminar Slice 1<\/h1>/);
    assert.doesNotMatch(html,/3,000 ms/);
    assert.match(html,/Response-time distribution/);
    assert.match(html,/<svg role="img"/);
    assert.match(html,/<table>/);
    assert.match(html,/synthetic &lt;check&gt;/);
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
        assert.match(html,/k6-dashboard-native.html/);
        assert.equal(html,await readFile(path.join(directory,'report.html'),'utf8'));
        const pdf=await readFile(path.join(directory,'report.pdf'));
        assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
        assert.match(pdf.toString(),/%%EOF/);
    } finally { await rm(directory,{recursive:true,force:true}); }
});

test('reports separate regular API latency from techpack latency without changing historical gates', () => {
    const current=structuredClone(summary);
    current.metrics['http_req_duration{traffic:application,workload:api}']={values:{'p(95)':1500,'p(99)':4000}};
    current.metrics['http_req_duration{traffic:application,workload:techpack}']={values:{'p(95)':20000,'p(99)':25000}};
    const model=presentationModel(current,{...metadata,roleConfiguration:{...metadata.roleConfiguration,techPackP95:30000,techPackP99:45000}},'FAIL');
    assert.equal(model.cards[0][1],'1.5 s');
    assert.equal(model.cards.find(card=>card[0]==='Techpack p95')[1],'20 s');
    assert.equal(model.cards.find(card=>card[0]==='Techpack p95')[2],'Target < 30 s');
    assert.equal(summary.metrics['http_req_duration{traffic:application}'].thresholds['p(95)<2000'].ok,false);
});
