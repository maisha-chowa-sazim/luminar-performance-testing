import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { receiveItemFixturePath, workOrderFixturePath } from '../config/environment.mjs';

test('receipt fixture selection and fresh variant mapping work for both environments', () => {
    assert.equal(workOrderFixturePath({ TEST_ENV: 'prod' }), '../data/prod/work-order.json');
    assert.equal(workOrderFixturePath({ TEST_ENV: 'qa' }), '../data/work-order.json');
    for (const TEST_ENV of ['qa', 'prod']) {
        const ctx = vm.createContext({ __ENV: { TEST_ENV }, receiveItemFixturePath,
            open: path => readFileSync(`k6/flows/${path}`, 'utf8'), uniqueId: () => 'fresh',
        });
        vm.runInContext(readFileSync('k6/flows/receive-item.js', 'utf8')
            .replace(/^import [^\n]+\n/gm, '').replace(/^export /gm, ''), ctx);
        const ids = TEST_ENV === 'prod' ? ['fresh-M', 'fresh-L'] : ['fresh-M'];
        const payload = JSON.parse(JSON.stringify(ctx.buildReceiveItemPayload('fresh-order', ids)));
        assert.equal(payload.workOrderId, 'fresh-order');
        assert.deepEqual(payload.items.map(row => row.poItemVariantId), ids);
        assert.ok(Number.isFinite(Date.parse(payload.receivedAt)));
        if (TEST_ENV === 'prod') {
            assert.deepEqual(payload.items.map(row => row.receivedQuantity), ['400.0000', '200.0000']);
            assert.ok(payload.items.every(row => row.measurementUnit === 'pieces'));
            assert.throws(() => ctx.buildReceiveItemPayload('fresh-order', 'one-id'), /one fresh variant ID/);
        }
    }
});
