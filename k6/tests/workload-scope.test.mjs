import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { roleConfig, roleOptions } from '../config/role-load.mjs';

test('only work-order approval and its supporting role are included', () => {
    for (const folder of ['k6/flows','k6/scenarios','k6/helpers']) for (const file of readdirSync(folder).filter(file=>file.endsWith('.js') || file.endsWith('.mjs'))) {
        const source=readFileSync(`${folder}/${file}`,'utf8');
        assert.doesNotMatch(source,/approveResource|submitPreCostingForApproval|\/approvals\/(?:BOM|COSTING|PURCHASE_ORDER)|login\(['"]executive/,file);
    }
    const users=JSON.parse(readFileSync('k6/data/users.json'));
    assert.deepEqual(Object.keys(users).sort(),['inventory','merchandiser','seniorMerchandiser']);
});
test('upload traffic has a separate configurable budget while regular API and failure gates remain', () => {
    const config=roleConfig({}), options=roleOptions(config), gates=options.thresholds;
    assert.deepEqual(gates['http_req_duration{traffic:application}'],[]);
    assert.deepEqual(gates['http_req_duration{traffic:application,workload:api}'],['p(95)<2000','p(99)<5000']);
    assert.deepEqual(gates['http_req_duration{traffic:application,workload:techpack}'],['p(95)<30000','p(99)<45000']);
    assert.deepEqual(gates['http_req_failed{traffic:application}'],['rate<0.01']);
    assert.ok(Object.values(options.scenarios).every(s=>s.tags.workload==='api'));
    assert.equal(roleConfig({ROLE_TECHPACK_P95_MS:'60000'}).techPackP95,60000);
    assert.throws(()=>roleConfig({ROLE_TECHPACK_P95_MS:'0'}),/ROLE_TECHPACK_P95_MS/);
});
test('every request in techpack creation overrides the default API workload tag', () => {
    const tags=[];
    const ctx=vm.createContext({open: (_path, mode)=>mode==='b'?new ArrayBuffer(1):JSON.stringify({files:[{fileName:'fixture.pdf',contentType:'application/pdf',type:'OTHER'}]}),
        check: (value,rules)=>Object.values(rules).every(rule=>rule(value)),getApiUrl:p=>p,tenantHeaders:()=>({}),console,
        http:{post:(url,body,params)=>{tags.push(params.tags);return {status:201,json:()=>({success:true,data:url.endsWith('upload-urls')?[{fileName:'fixture.pdf',uploadUrl:'https://storage.example.test',fileKey:'key',fields:{}}]:{id:'pack'}})};}}});
    vm.runInContext(readFileSync('k6/flows/tech-pack.js','utf8').replace(/import[^\n]+\n/g,'').replace(/^export /gm,''),ctx);
    ctx.createTechPack('synthetic','style');
    assert.equal(tags.length,3);
    assert.ok(tags.every(tag=>tag.workload==='techpack'));
});

test('work-order approval and supplier status precede handoff; failed approval prevents handoff', () => {
    const calls=[], Metric=class {add(){}};
    const response=data=>({status:201,json:()=>({success:true,data})});
    const ctx=vm.createContext({__ENV:{},Counter:Metric,Rate:Metric,Trend:Metric,sleep(){},think(){},
        execution:{vu:{idInTest:1}},uniqueId:()=> 'synthetic',console:{warn:message=>assert.fail(message)},
        operation:(_name,fn)=>fn(),responseData:(r,status)=>{if(r.status!==status)throw Error('HTTP failure');return r.json().data;},
        requireCondition:(ok,step)=>assert.ok(ok,step),
        coordinate:(route)=>{calls.push(route);return route==='/account'?{index:0}:{};},
        sessionFor:(_data,role)=>{assert.ok(['merchandiser','seniorMerchandiser'].includes(role));return {token:role};},
        approveWorkOrder:token=>{assert.equal(token,'seniorMerchandiser');calls.push('approve');return response({id:'approval'});},
        sendWorkOrderToSupplier:token=>{assert.equal(token,'seniorMerchandiser');calls.push('supplier');return {status:200,json:()=>({success:true,data:{id:'order'}})};},
        createStyle:()=>response({id:'style'}),createTechPack:()=>response({id:'pack'}),
        createSample:()=>response({id:'sample',styleId:'style'}),createBom:()=>response({id:'bom',styleId:'style'}),
        createPreCosting:()=>response({id:'costing'}),createPurchaseOrder:()=>response({id:'purchase',styles:[{id:'style'}]}),
        createWorkOrder:()=>response({id:'order'}),
        readApplication:(_url,name)=>name==='style_get'?{id:'style',combos:[{id:'combo'}]}:{id:'order',status:'SENT_TO_SUPPLIER',items:[{variants:[{id:'variant',style:{id:'style'},purchaseOrder:{id:'purchase'}}]}]},
    });
    vm.runInContext(readFileSync('k6/flows/role-journeys.js','utf8').replace(/import[\s\S]*?from '[^']+';\n/g,'').replace(/^export /gm,''),ctx);
    ctx.merchandiserJourney({runId:'synthetic',startedAt:Date.now(),config:roleConfig({})});
    assert.ok(calls.includes('/ready'));
    assert.ok(!calls.includes('/failed'));
    assert.ok(calls.indexOf('approve') < calls.indexOf('supplier'));
    assert.ok(calls.indexOf('supplier') < calls.indexOf('/ready'));
    calls.length=0;ctx.console={warn(){}};ctx.approveWorkOrder=()=>({status:400});
    ctx.merchandiserJourney({runId:'synthetic',startedAt:Date.now(),config:roleConfig({})});
    assert.ok(calls.includes('/failed'));
    assert.ok(!calls.includes('/ready'));
    assert.ok(!calls.includes('supplier'));
});
