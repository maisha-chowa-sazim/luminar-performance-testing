import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function source(file) {
    return readFileSync(file, 'utf8').replace(/import[\s\S]*?from ['"][^'"]+['"];\n/g, '').replace(/^export /gm, '');
}
class Metric { add() {} }

test('feature-disabled responses retain an allowlisted code without response contents', () => {
    const ctx = vm.createContext({ Counter: Metric, Trend: Metric, check() {} });
    vm.runInContext(source('k6/helpers/role-runtime.js'), ctx);
    const response = error => ({ status: 403, json: () => ({ error, message: 'private response contents' }) });
    assert.throws(() => ctx.responseData(response('FEATURE_DISABLED'), 201, 'grn_item_inspect'), error => {
        assert.equal(error.kind, 'feature_disabled');
        assert.equal(error.errorCode, 'FEATURE_DISABLED');
        assert.equal(error.httpStatus, 403);
        assert.equal(error.message.includes('private'), false);
        return true;
    });
    assert.throws(() => ctx.responseData(response('private-code'), 201, 'grn_item_inspect'), error => {
        assert.equal(error.kind, 'authentication_or_permission');
        assert.equal(error.errorCode, undefined);
        return true;
    });
});

test('smoke failures persist the claimed order before aborting and send no receipt writes', () => {
    const events = [];
    const abort = new Error('synthetic abort');
    const ctx = vm.createContext({
        Counter: Metric, Rate: Metric, Trend: Metric, __ENV: { ROLE_STOP_ON_ERROR: '1' },
        execution: { vu: { idInTest: 2 }, test: { abort: () => { events.push('abort'); throw abort; } } },
        console: { warn() {} }, sleep() {}, operation: (name, fn) => fn(),
        sessionFor: () => ({ token: 'synthetic' }), think() {},
        coordinate: (path, body) => {
            events.push(path);
            if (path === '/account') return { index: 0 };
            if (path === '/claim') return { order: { id: 'order', claim: 'claim' } };
            if (path === '/failed') assert.equal(body.step, 'work_order_find');
            return {};
        },
        readApplication: () => { throw Object.assign(new Error('403'), { kind: 'feature_disabled', httpStatus: 403, errorCode: 'FEATURE_DISABLED' }); },
        writeApplication: () => assert.fail('No dependent write may be dispatched'),
    });
    vm.runInContext(source('k6/flows/role-journeys.js'), ctx);
    assert.throws(() => ctx.inventoryJourney({ config: { pollInterval: 2 } }), error => error === abort);
    assert.deepEqual(events, ['/account', '/claim', '/failed', 'abort']);
});
