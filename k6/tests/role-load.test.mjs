import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { roleConfig, roleOptions, seconds, configuredThinkRanges } from '../config/role-load.mjs';
import { selectRoleAccounts } from '../helpers/role-accounts.mjs';
import { startRoleCoordinator } from '../reporting/role-coordinator.mjs';
import { reportModel } from '../reporting/report.mjs';

const users = JSON.parse(readFileSync('k6/data/users.json'));
function credentials() {
    const env = { MERCHANDISER_ACCOUNT_COUNT: '50', INVENTORY_ACCOUNT_COUNT: '12' };
    for (const [role, count] of [['MERCHANDISER', 50], ['INVENTORY', 12]]) for (let i = 1; i <= count; i++) {
        env[`${role}_ACCOUNT_${i}_EMAIL`] = `${role}-${i}@example.test`;
        env[`${role}_ACCOUNT_${i}_PASSWORD`] = 'synthetic-password';
    }

    env.SENIOR_MERCHANDISER_EMAIL = 'senior@example.test';
    env.SENIOR_MERCHANDISER_PASSWORD = 'synthetic-password';
    return env;
}

test('independent-role allocations preserve the 50-VU cap throughout ramps, grace, and drain', () => {
    for (const total of [2, 5, 10, 20, 50]) {
        const config = roleConfig({ ROLE_TOTAL_VUS: total });
        const options = roleOptions(config);
        const peak = Object.values(options.scenarios).reduce((sum, scenario) => sum + Math.max(...scenario.stages.map(s => s.target)), 0);
        assert.equal(peak, total);
        assert.ok(peak <= 50);
        assert.ok(seconds(config.steady) >= 600);
        assert.equal(options.scenarios.merchandiser.exec, 'merchandiser');
        assert.equal(options.scenarios.inventory.exec, 'inventory');
    }
    assert.throws(() => roleConfig({ ROLE_TOTAL_VUS: '51' }), /ROLE_TOTAL_VUS/);
    assert.throws(() => roleConfig({ ROLE_TOTAL_VUS: '50', ROLE_MERCHANDISER_VUS: '45', ROLE_INVENTORY_VUS: '10' }), /summing/);
    assert.throws(() => roleConfig({ ROLE_STEADY: '-1m' }), /duration/);
    assert.throws(() => roleConfig({ ROLE_STEADY: '0s' }), /ROLE_STEADY/);
    assert.equal(roleConfig({ ROLE_TOTAL_VUS: '12', ROLE_MERCHANDISER_VUS: '9', ROLE_INVENTORY_VUS: '3' }).total, 12);
});

test('role credential pools select distinct real variable mappings and fail before traffic on shortages', () => {
    const config = roleConfig({ ROLE_TOTAL_VUS: '50' });
    const env = credentials();
    const selected = selectRoleAccounts(env, users, config);
    assert.equal(selected.merchandiser.length, 40);
    assert.equal(selected.inventory.length, 10);
    assert.equal(selected.merchandiser[39].emailEnvKey, 'MERCHANDISER_ACCOUNT_40_EMAIL');
    assert.throws(() => selectRoleAccounts({ ...env, INVENTORY_ACCOUNT_COUNT: '9' }, users, config), /Insufficient/);
    assert.throws(() => selectRoleAccounts({ ...env, MERCHANDISER_ACCOUNT_40_PASSWORD: '' }, users, config), /ACCOUNT_40_PASSWORD/);
    assert.throws(() => selectRoleAccounts({ ...env, INVENTORY_ACCOUNT_1_EMAIL: env.MERCHANDISER_ACCOUNT_1_EMAIL }, users, config), /Duplicate/);
});

test('atomic handoff prevents duplicate claims, keeps failed claims, rejects cross-run access, and persists backlog', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'luminar-handoff-test-'));
    const coordinator = await startRoleCoordinator(directory, 'synthetic-run', roleConfig({}));
    const call = async (route, body, key = coordinator.secret) => {
        const response = await fetch(coordinator.url + route, { method: 'POST', headers: { 'x-coordinator-key': key }, body: JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
    };
    try {
        assert.equal((await call('/summary', {}, 'wrong-run-key')).status, 403);
        assert.equal((await call('/ready', { id: 'unregistered-real-order' })).status, 404);
        for (let i = 0; i < 10; i++) {
            await call('/workflow', { id: `flow-${i}` });
            await call('/orders', { id: `order-${i}`, workflowId: `flow-${i}`, styleId: 'style', purchaseOrderId: 'purchase' });
            await call('/ready', { id: `order-${i}` });
        }
        const claims = await Promise.all(Array.from({ length: 40 }, (_, i) => call('/claim', { owner: `inventory-${i}` })));
        const orders = claims.map(c => c.data.order).filter(Boolean);
        assert.equal(orders.length, 10);
        assert.equal(new Set(orders.map(o => o.id)).size, 10);
        const first = orders[0];
        assert.equal((await call('/finish', { ...first, claim: 'wrong', grnId: 'grn' })).status, 409);
        assert.equal((await call('/finish', { ...first, grnId: 'grn' })).status, 200);
        assert.equal((await call('/finish', { ...first, grnId: 'grn' })).status, 409);
        await call('/failed', { ...orders[1], step: 'grn_create', receiptDispatched: true });
        assert.equal((await call('/claim', { owner: 'late-consumer' })).data.order, null);
        const ledger = JSON.parse(await readFile(`${directory}/handoff-ledger.json`, 'utf8'));
        assert.equal(ledger.stats.received, 1);
        assert.equal(ledger.stats.pending, 9);
        assert.equal(ledger.stats.failed, 1);
        assert.equal(ledger.stats.duplicateAttempts, 1);
        assert.equal(ledger.orders[1].receiptDispatched, true);
        assert.ok(!JSON.stringify(ledger).includes(coordinator.secret));
        const allocation = await Promise.all(Array.from({ length: 8 }, (_, i) => call('/account', { role: 'merchandiser', vu: i + 100 })));
        assert.equal(new Set(allocation.map(a => a.data.index)).size, 8);
        assert.equal((await call('/account', { role: 'merchandiser', vu: 100 })).data.index, allocation[0].data.index);
        assert.equal((await call('/account', { role: 'merchandiser', vu: 999 })).status, 409);
    } finally { await coordinator.close(); await rm(directory, { recursive: true, force: true }); }
});

function runtimeHarness() {
    const metrics = new Map();
    class Metric { constructor(name) { this.name = name; } add(value) { metrics.set(this.name, (metrics.get(this.name) || 0) + value); } }
    let logins = 0;
    const ctx = vm.createContext({ __ENV: {}, http: {}, configuredThinkRanges, check: (value, rules) => Object.values(rules).every(rule => rule(value)),
        sleep() {}, Counter: Metric, Trend: Metric, requiredEnvValue() {}, getApiUrl() {}, tenantHeaders() {},
        authenticateAccount: () => { logins++; return { token: 'refreshed', label: 'synthetic' }; } });
    vm.runInContext(readFileSync('k6/helpers/role-runtime.js', 'utf8').replace(/import[\s\S]*?from '[^']+';\n/g, '').replace(/^export /gm, ''), ctx);
    return { ctx, metrics, logins: () => logins };
}

test('expired sessions refresh at a safe boundary and business responses require more than HTTP 200', () => {
    const h = runtimeHarness();
    const config = { sessionMaxAge: 900, thinkScale: 0, think: h.ctx.thinkRanges({}) };
    const data = { accounts: { inventory: [{}] }, sessions: { inventory: [{ token: 'valid', authenticatedAt: Date.now() }] } };
    const first = h.ctx.sessionFor(data, 'inventory', 0, config);
    assert.equal(h.logins(), 0);
    assert.throws(() => h.ctx.responseData({ status: 401, json: () => ({}) }, 201, 'receive', first), /HTTP 401/);
    assert.equal(first.token, null);
    assert.equal(h.ctx.sessionFor(data, 'inventory', 0, config).token, 'refreshed');
    assert.equal(h.logins(), 1);
    assert.throws(() => h.ctx.responseData({ status: 200, json: () => ({ success: false }) }, 200, 'read', first), /validation/);
    assert.throws(() => h.ctx.thinkRanges({ ROLE_THINK_STYLE_MIN: '45', ROLE_THINK_STYLE_MAX: '15' }), /Invalid think/);
});

test('receipt validators reject wrong dependencies, prior receipts, missing quantities, and incorrect stock quantities', () => {
    const h = runtimeHarness();
    const noop = class { add() {} };
    Object.assign(h.ctx, { execution: {}, Counter: noop, Rate: noop, Trend: noop });
    vm.runInContext(readFileSync('k6/flows/role-journeys.js', 'utf8').replace(/import[\s\S]*?from '[^']+';\n/g, '').replace(/^export /gm, ''), h.ctx);
    const claim = { id: 'order', styleId: 'style', purchaseOrderId: 'purchase' };
    const order = { id: 'order', status: 'SENT_TO_SUPPLIER', items: [{ measurementUnit: 'pieces', variants: [
        { id: 'variant', style: { id: 'style' }, purchaseOrder: { id: 'purchase' }, quantity: '250', receivedQuantity: '0' },
    ] }] };
    const items = h.ctx.receivableItems(order, claim);
    assert.equal(items[0].receivedQuantity, 250);
    const grn = { id: 'grn', workOrder: { id: 'order' }, items: [{ id: 'item', poItemVariant: { id: 'variant' }, receivedQuantity: '250', measurementUnit: 'pieces' }] };
    h.ctx.validateReceipt(grn, claim, items);
    assert.throws(() => h.ctx.validateReceipt({ ...grn, workOrder: { id: 'another-order' } }, claim, items), /integrity/);
    assert.throws(() => h.ctx.validateReceipt({ ...grn, items: [{ ...grn.items[0], receivedQuantity: '120' }] }, claim, items), /quantity/);
    order.items[0].variants[0].receivedQuantity = '1';
    assert.throws(() => h.ctx.receivableItems(order, claim), /quantity/);
    order.items[0].variants[0].style.id = 'unrelated-style';
    assert.throws(() => h.ctx.receivableItems(order, claim), /integrity/);
});

test('role reports fail an unresolved backlog and do not pass without final reconciliation metrics', () => {
    const metadata = { exitCode: 0, roleConfiguration: roleConfig({}), roleHandoff: { attempted: 100, received: 98, pending: 2 } };
    const summary = { metrics: { http_reqs: { values: { count: 100 } }, e2e_success: { values: { rate: 0.98 }, thresholds: { 'rate>=0.99': { ok: false } } } } };
    assert.equal(reportModel(summary, metadata).status, 'FAIL');
    assert.equal(reportModel({ metrics: { http_reqs: { values: { count: 100 } } } }, metadata).status, 'INCOMPLETE');
});

test('a failed create stops dependent business actions and an ambiguous receipt is sent only once', () => {
    for (const role of ['merchandiser', 'inventory']) {
        const h = runtimeHarness();
        const noop = class { add() {} };
        const calls = [];
        const claim = { id: 'order', styleId: 'style', purchaseOrderId: 'purchase', claim: 'claim-token' };
        Object.assign(h.ctx, { execution: { vu: { idInTest: 1 } }, Counter: noop, Rate: noop, Trend: noop });
        vm.runInContext(readFileSync('k6/flows/role-journeys.js', 'utf8').replace(/import[\s\S]*?from '[^']+';\n/g, '').replace(/^export /gm, ''), h.ctx);
        Object.assign(h.ctx, {
            uniqueId: () => 'synthetic-id', console: { warn() {} },
            sessionFor: () => ({ token: 'synthetic-token' }), think() {},
            coordinate: (route, body) => { calls.push([route, body]); return route === '/account' ? { index: 0 } : route === '/claim' ? { order: claim } : {}; },
            createStyle: () => ({ status: 400, json: () => ({ success: false }) }),
            createTechPack: () => { calls.push(['unexpected-techpack']); throw new Error('Must not execute'); },
            readApplication: (_path, name) => name === 'grn_list' ? { data: [], meta: { total: 0 } } :
                { id: 'order', status: 'SENT_TO_SUPPLIER', items: [{ measurementUnit: 'pieces', variants: [
                    { id: 'variant', style: { id: 'style' }, purchaseOrder: { id: 'purchase' }, quantity: '250', receivedQuantity: '0' },
                ] }] },
            writeApplication: (...args) => { calls.push(['write', args]); return { status: 503, json: () => ({ success: false }) }; },
        });
        const config = { ...roleConfig({}), think: h.ctx.thinkRanges({}), thinkScale: 0 };
        const data = { config, startedAt: Date.now(), runId: 'synthetic' };
        if (role === 'merchandiser') {
            h.ctx.merchandiserJourney(data);
            assert.equal(calls.some(([route]) => route === 'unexpected-techpack'), false);
            assert.equal(calls.find(([route]) => route === '/workflow-failed')[1].httpStatus, 400);
        } else {
            h.ctx.inventoryJourney(data);
            assert.equal(calls.filter(([route]) => route === 'write').length, 1);
            assert.equal(calls.some(([route]) => route === '/finish'), false);
            const failed = calls.find(([route]) => route === '/failed')[1];
            assert.equal(failed.receiptDispatched, true);
            assert.equal(failed.kind, 'backend');
            assert.equal(failed.httpStatus, 503);
        }
    }
});

test('inventory verifies receipt quantities without inspection or stock API calls', () => {
    const h = runtimeHarness(), calls = [];
    const Metric = class { add() {} };
    Object.assign(h.ctx, { execution: { vu: { idInTest: 1 } }, Counter: Metric, Rate: Metric, Trend: Metric });
    vm.runInContext(readFileSync('k6/flows/role-journeys.js', 'utf8').replace(/import[\s\S]*?from '[^']+';\n/g, '').replace(/^export /gm, ''), h.ctx);
    const claim = { id: 'order', styleId: 'style', purchaseOrderId: 'purchase', claim: 'claim' };
    const order = received => ({ id: 'order', status: received ? 'RECEIVED' : 'SENT_TO_SUPPLIER', items: [{ measurementUnit: 'pieces', variants: [
        { id: 'variant', style: { id: 'style' }, purchaseOrder: { id: 'purchase' }, quantity: '250', receivedQuantity: received ? '250' : '0' },
    ] }] });
    const grn = { id: 'grn', workOrder: { id: 'order' }, items: [{ id: 'item', poItemVariant: { id: 'variant' }, receivedQuantity: '250', addedToInventoryQuantity: '0', measurementUnit: 'pieces' }] };
    let lists = 0;
    Object.assign(h.ctx, {
        uniqueId: () => 'id', console: { warn: message => assert.fail(message) }, sessionFor: () => ({ token: 'synthetic' }), think() {},
        coordinate: (route, body) => { calls.push(route); return route === '/account' ? { index: 0 } : route === '/claim' ? { order: claim } : {}; },
        readApplication: (_path, name) => {
            if (name === 'work_order_find') return order(false);
            if (name === 'work_order_get') return order(true);
            if (name === 'grn_get') return grn;
            if (name === 'grn_list') return ++lists === 1 ? { data: [], meta: { total: 0 } } : { data: [grn], meta: { total: 1 } };
            assert.fail(`Unexpected read: ${name}`);
        },
        writeApplication: (_method, path, payload) => {
            calls.push(path);
            assert.ok(!path.includes('inspect'));
            assert.equal(payload.qcStatus, undefined);
            assert.equal(path, '/api/v1/grn');
            return { status: 201, json: () => ({ success: true, data: grn }) };
        },
    });
    h.ctx.inventoryJourney({ config: { ...roleConfig({}), think: h.ctx.thinkRanges({}), thinkScale: 0 }, runId: 'synthetic' });
    assert.ok(calls.includes('/finish'));
    assert.equal(calls.includes('/failed'), false);
    assert.deepEqual(calls.filter(path => path.startsWith('/api')), ['/api/v1/grn']);
});

test('k6 parses both independent scenarios with the correct maximum allocation without API traffic', () => {
    const result = spawnSync('k6', ['inspect', '--include-system-env-vars', 'k6/scenarios/load-roles.js'], {
        encoding: 'utf8', env: { ...process.env, ROLE_TOTAL_VUS: '50', LOGIN_DELAY_SECONDS: '1', LOGIN_MAX_RETRIES: '2', LOGIN_MAX_RETRY_WAIT_SECONDS: '120' },
    });
    assert.equal(result.status, 0, result.stderr);
    const options = JSON.parse(result.stdout);
    assert.equal(options.scenarios.merchandiser.stages[1].target, 40);
    assert.equal(options.scenarios.inventory.stages[1].target, 10);
    assert.deepEqual(options.thresholds.e2e_success, ['rate>=0.99']);
});

test('real isolated k6 VUs hand off synthetic orders through the coordinator exactly once (no Luminar requests)', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'luminar-k6-handoff-'));
    const coordinator = await startRoleCoordinator(directory, 'synthetic-k6', { merchandiser: 2, inventory: 2 });
    const scenario = path.join(directory, 'synthetic.js');
    await writeFile(scenario, `import http from 'k6/http';
import { sleep, check } from 'k6';
export const options = { scenarios: {
    producer: { executor: 'per-vu-iterations', exec: 'producer', vus: 2, iterations: 1, maxDuration: '15s' },
    consumer: { executor: 'per-vu-iterations', exec: 'consumer', vus: 2, iterations: 1, maxDuration: '15s' },
}, thresholds: { checks: ['rate==1'] } };
function call(route, body) {
    const r = http.post(__ENV.COORDINATOR_URL + route, JSON.stringify(body), { headers: { 'x-coordinator-key': __ENV.COORDINATOR_KEY } });
    check(r, { 'synthetic coordinator request succeeds': r => r.status === 200 }); return r.json();
}
export function producer() {
    const id = 'synthetic-' + __VU;
    call('/workflow', { id }); call('/orders', { id, workflowId: id, styleId: 'synthetic-style', purchaseOrderId: 'synthetic-purchase' });
    call('/ready', { id });
}
export function consumer() {
    const owner = 'consumer-' + __VU;
    for (let i = 0; i < 100; i++) {
        const order = call('/claim', { owner }).order;
        if (order) { call('/finish', { ...order, owner, grnId: 'synthetic-grn-' + order.id }); return; }
        sleep(0.05);
    }
    check(false, { 'synthetic order available within timeout': () => false });
}
`);
    try {
        const result = await new Promise((resolve, reject) => {
            const child = spawn('k6', ['run', '--include-system-env-vars', '--no-usage-report', scenario], {
                env: { ...process.env, COORDINATOR_URL: coordinator.url, COORDINATOR_KEY: coordinator.secret, K6_WEB_DASHBOARD: 'false' },
            });
            let output = '';
            child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
            child.on('error', reject); child.on('close', code => resolve({ code, output }));
        });
        assert.equal(result.code, 0, result.output);
        assert.equal(coordinator.snapshot().stats.received, 2);
        assert.equal(coordinator.snapshot().stats.pending, 0);
    } finally { await coordinator.close(); await rm(directory, { recursive: true, force: true }); }
});
