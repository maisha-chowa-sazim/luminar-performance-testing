import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

function harness(responses = [], settings = {}) {
    const users = JSON.parse(fs.readFileSync('k6/data/users.json'));
    const env = {
        BASE_URL: 'https://example.test',
        LOGIN_DELAY_SECONDS: '1',
        LOGIN_MAX_RETRIES: '2',
        LOGIN_MAX_RETRY_WAIT_SECONDS: '120',
        ...settings,
    };
    for (const config of Object.values(users)) for (const account of config.accounts || [config]) {
        env[account.emailEnvKey] = account.emailEnvKey;
        env[account.passwordEnvKey] = 'dummy';
    }
    const requests = [], sleeps = [], checks = [];
    const ctx = vm.createContext({ __ENV: env, open: () => JSON.stringify(users),
        http: { cookieJar: () => ({ clear() {} }), post: (url, payload) => {
            requests.push(JSON.parse(payload));
            return responses.shift() || { status: 200, headers: {}, json: () => ({ token: `token-${requests.length}` }) };
        } },
        sleep: n => sleeps.push(n), console: { log() {}, warn() {} },
        check: (r, rules) => { const ok = Object.values(rules).every(fn => fn(r)); checks.push(ok); return ok; },
    });
    vm.runInContext(fs.readFileSync('k6/helpers/session-pool.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), ctx);
    return { ctx, env, requests, sleeps, checks };
}

test('41 sessions are authenticated once, paced, and reused by stable VU assignment', () => {
    const h = harness();
    const data = h.ctx.setupSessions();
    assert.equal(h.requests.length, 41);
    assert.equal(new Set(h.requests.map(r => r.email)).size, 41);
    assert.deepEqual(h.sleeps, Array(41).fill(1));
    for (let vu = 1; vu <= 20; vu++) {
        const first = h.ctx.sessionsForVU(data, vu);
        assert.equal(first.merchandiser.token, data.sessions.merchandiser[vu - 1].token);
        assert.equal(first.inventory.token, data.sessions.inventory[vu - 1].token);
    }
    assert.equal(h.requests.length, 41);
});

test('429 uses Retry-After, preserves final result, and limits retries', () => {
    const limited = { status: 429, headers: { 'Retry-After': '12' }, json: () => ({}) };
    const h = harness([limited]);
    h.ctx.authenticateAccount(vm.runInContext('accounts[0]', h.ctx));
    assert.deepEqual(h.sleeps, [12, 1]);
    assert.deepEqual(h.checks, [true]);
    const exhausted = harness([limited, limited, limited]);
    assert.throws(() => exhausted.ctx.setupSessions(), /business load cancelled/);
    assert.equal(exhausted.requests.length, 3);
    const tooLong = harness([{ ...limited, headers: { 'Retry-After': '121' } }]);
    assert.throws(() => tooLong.ctx.setupSessions(), /business load cancelled/);
    assert.equal(tooLong.requests.length, 1);
    assert.equal(h.ctx.retryAfterSeconds('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60);
});

test('missing credentials fail before HTTP and non-retryable failures stop setup', () => {
    const h = harness();
    delete h.env.INVENTORY_U20_PASSWORD;
    assert.throws(() => h.ctx.setupSessions(), /INVENTORY_U20_PASSWORD/);
    assert.equal(h.requests.length, 0);
    const failed = harness([{ status: 401, headers: {}, json: () => ({}) }]);
    assert.throws(() => failed.ctx.setupSessions(), /business load cancelled/);
    assert.equal(failed.requests.length, 1);
});

test('429 without Retry-After waits for a bounded throttle cooldown, not the inter-account delay', () => {
    const limited = { status: 429, headers: {}, json: () => ({}) };
    const h = harness([limited, limited]);
    assert.ok(h.ctx.authenticateAccount(vm.runInContext('accounts[0]', h.ctx)));
    assert.deepEqual(h.sleeps, [30, 60, 1]);
    assert.equal(h.requests.length, 3);
    const explicit = harness([limited], { LOGIN_DELAY_SECONDS: '5', LOGIN_RETRY_BASE_SECONDS: '45' });
    explicit.ctx.authenticateAccount(vm.runInContext('accounts[0]', explicit.ctx));
    assert.deepEqual(explicit.sleeps, [45, 5]);
    const excessive = harness([limited], { LOGIN_RETRY_BASE_SECONDS: '121' });
    assert.equal(excessive.ctx.authenticateAccount(vm.runInContext('accounts[0]', excessive.ctx)), null);
    assert.equal(excessive.requests.length, 1);
});

test('k6 loads arrival rate and sequential verification options without network requests', () => {
    for (const name of ['load-arrival-rate', 'test-scenarios/login-all-users']) {
        const result = spawnSync('k6', ['inspect', '--include-system-env-vars', `k6/scenarios/${name}.js`], {
            encoding: 'utf8',
            env: {
                ...process.env,
                LOGIN_SETUP_TIMEOUT: '30m',
                LOGIN_DELAY_SECONDS: '1',
                LOGIN_MAX_RETRIES: '2',
                LOGIN_MAX_RETRY_WAIT_SECONDS: '120',
                LOGIN_MAX_DURATION: '30m',
                THINK_TIME_SECONDS: '3',
                JOURNEY_RATE: '5',
                JOURNEY_VUS: '20',
                JOURNEY_TIME_UNIT: '1m',
                JOURNEY_DURATION: '5m',
            },
        });
        assert.equal(result.status, 0, result.stderr);
        const options = JSON.parse(result.stdout);
        if (name === 'load-arrival-rate') {
            assert.equal(options.scenarios.arrival_journey.executor, 'constant-arrival-rate');
            assert.deepEqual(options.thresholds.dropped_iterations, ['count==0']);
            assert.ok(options.thresholds['http_req_failed{scenario:arrival_journey}']);
        } else {
            assert.equal(options.scenarios.login_all_users.vus, 1);
            assert.equal(options.scenarios.login_all_users.iterations, 41);
        }
    }
});

test('business journeys reuse role tokens across iterations without logging in', () => {
    const source = fs.readFileSync('k6/scenarios/full-journey.js', 'utf8');
    const calls = [];
    const ctx = { __ENV: {}, testEnvironment: () => null, FUNCTIONAL_THRESHOLDS: {}, check: () => true,
        login: () => { throw new Error('Unexpected login during business workload'); } };
    for (const name of ['createStyle', 'createSample', 'createTechPack', 'createBom', 'createPreCosting',
        'createPurchaseOrder', 'createWorkOrder', 'createReceiveItem', 'approveWorkOrder']) {
        ctx[name] = (token) => { calls.push([name, token]); return { status: 201, json: () => ({ success: true }) }; };
    }
    ctx.sendWorkOrderToSupplier = token => { calls.push(['sendWorkOrderToSupplier', token]); return {status:200,json:()=>({success:true})}; };
    ctx.getStyleDetails = () => ({ combos: [{ id: 'combo' }] });
    for (const name of ['getCreatedStyleId', 'getCreatedBomId', 'getCreatedPreCostingId',
        'getCreatedPurchaseOrderId', 'getCreatedWorkOrderId', 'getCreatedWorkOrderVariantId']) ctx[name] = () => 'id';
    vm.createContext(ctx);
    vm.runInContext(source.replace(/import[\s\S]*?from '[^']+';\n/g, '')
        .replace('export default function (sessions)', 'function run(sessions)').replace(/^export /gm, ''), ctx);
    const sessions = Object.fromEntries(['merchandiser', 'inventory', 'seniorMerchandiser']
        .map(role => [role, { token: `${role}-token` }]));
    assert.equal(ctx.run(sessions), true);
    assert.equal(ctx.run(sessions), true);
    assert.ok(calls.filter(([name]) => name === 'createStyle').every(([, token]) => token === 'merchandiser-token'));
    assert.ok(calls.filter(([name]) => name === 'createReceiveItem').every(([, token]) => token === 'inventory-token'));
});
