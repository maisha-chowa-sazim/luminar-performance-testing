import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fixture = JSON.parse(readFileSync('k6/data/work-order.json', 'utf8'));
function harness(data = fixture) {
    const requests = [];
    const ctx = vm.createContext({
        open: () => JSON.stringify(data), requiredEnvValue: () => 'buyer',
        getApiUrl: path => path, tenantHeaders: () => ({}), console: { error() {} },
        check: (value, rules) => Object.values(rules).every(rule => rule(value)),
        http: { get: url => {
            requests.push({ url, method: 'GET' });
            return { status: 200, json: () => ({ success: true, data: { id: 'created-purchase', orderItems: [
                { style: { id: 'created-style' }, size: 'M', color: 'Black', quantity: 400 },
                { style: { id: 'created-style' }, size: 'L', color: 'Black', quantity: 200 },
            ] } }) };
        }, post: (url, payload) => {
            requests.push({ url, payload: payload ? JSON.parse(payload) : null });
            return { status: 201, json: () => ({ success: true, data: { id: url.endsWith('reserve-number') ? 'fresh-reservation' : 'work-order' } }) };
        } },
    });
    vm.runInContext(readFileSync('k6/flows/work-order.js', 'utf8').replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), ctx);
    return { ctx, requests };
}

test('work-order creation sends its own fixture currency and fresh dependent IDs', () => {
    const h = harness();
    const response = h.ctx.createWorkOrder('synthetic-token', 'created-purchase', 'created-style');
    assert.equal(response.status, 201);
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[0].url, '/api/v1/purchase-orders/created-purchase');
    assert.equal(h.requests[1].url, '/api/v1/work-orders/reserve-number');
    const { payload } = h.requests[2];
    assert.equal(payload.currency, 'USD');
    assert.equal(payload.reservationId, 'fresh-reservation');
    assert.equal(payload.buyerId, 'buyer');
    for (const item of payload.items) for (const variant of item.variants) {
        assert.equal(variant.purchaseOrderId, 'created-purchase');
        assert.equal(variant.styleId, 'created-style');
        assert.equal(variant.garmentColor, 'Black');
        assert.equal('variantGroupId' in variant, false);
    }
    assert.deepEqual(Array.from(payload.items[0].variants, value => value.garmentsQuantity), ['400', '200']);
    assert.deepEqual(Array.from(payload.items[0].variants, value => value.quantity), ['200', '100']);
    assert.equal(fixture.reservationId, 'c5f7a4c0-5dfb-4d7d-98fb-8d1b6f8e3871');
});

test('work-order rows reject unrelated styles, missing sizes, and ambiguous colors', () => {
    const h = harness();
    const row = { style: { id: 'style' }, size: 'M', color: 'Black', quantity: 400 };
    const build = rows => h.ctx.buildWorkOrderPayload('reservation', 'purchase', 'style', { id: 'purchase', orderItems: rows });
    assert.throws(() => build([row]), /style\/sizes/); // L is absent.
    assert.throws(() => build([{ ...row, style: { id: 'other-style' } }]), /style\/sizes/);
    assert.throws(() => build([row, { ...row, color: 'White' }]), /color is missing or ambiguous/);
    assert.throws(() => h.ctx.buildWorkOrderPayload('reservation', 'purchase', 'style'), /Matching purchase-order details/);
    const payload = build([row, { ...row, size: 'L', quantity: 200 }]);
    assert.equal(payload.items[0].variants[0].quantity, '200');
});

test('missing or unsupported work-order currency fails before any reservation or creation request', () => {
    for (const currency of [undefined, '', 'INVALID']) {
        const h = harness({ ...fixture, currency });
        assert.throws(() => h.ctx.createWorkOrder('synthetic-token', 'purchase', 'style'), /supported work-order currency/);
        assert.equal(h.requests.length, 0);
    }
});
