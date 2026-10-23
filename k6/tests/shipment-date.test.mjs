import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shipmentDate } from '../helpers/shipment-date.mjs';
import { purchaseFixturePath } from '../config/environment.mjs';

const fixture = JSON.parse(readFileSync('k6/data/purchase.json', 'utf8'));
const rule = fixture.shipments[0].shipmentDate;

test('shipment dates use today plus 30 calendar days in the fixture timezone, including rollover', () => {
    assert.equal(shipmentDate(rule, Date.parse('2026-10-15T19:00:00Z')), '2026-11-15'); // Already October 16 in Dhaka.
    assert.equal(shipmentDate(rule, Date.parse('2026-12-15T12:00:00Z')), '2027-01-14');
    assert.equal(shipmentDate(rule, Date.parse('2028-02-01T00:00:00Z')), '2028-03-02');
    assert.throws(() => shipmentDate({ ...rule, daysFromToday: -1 }), /Invalid shipment date rule/);
    assert.throws(() => shipmentDate('2026-09-28'), /Invalid shipment date rule/);
});

test('purchase payload resolves fixture dates without a shipment environment value and preserves dynamic dependencies', () => {
    const env = { LUMINAR_BUYER_ID: 'buyer', LUMINAR_PAYMENT_PROVIDER_ID: 'provider' };
    const ctx = vm.createContext({ __ENV: {}, purchaseFixturePath, open: () => JSON.stringify(fixture), uniqueId: () => 'unique', http: {}, check() {},
        shipmentDate: value => shipmentDate(value, Date.parse('2026-10-16T00:00:00Z')),
        requiredEnvValue: key => { assert.ok(env[key], `Unexpected required environment variable: ${key}`); return env[key]; },
    });
    vm.runInContext(readFileSync('k6/flows/purchase-order.js', 'utf8')
        .replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), ctx);
    const payload = JSON.parse(JSON.stringify(ctx.buildPurchaseOrderPayload('new-style', 'new-combo', 'test-run')));
    assert.equal(payload.shipments[0].shipmentDate, '2026-11-15');
    assert.equal(payload.shipments[0].shipmentMode, fixture.shipments[0].shipmentMode);
    assert.equal(payload.buyerId, 'buyer');
    assert.equal(payload.paymentProviderId, 'provider');
    assert.equal(payload.currency, 'USD');
    for (const item of payload.shipments[0].orderItems) {
        assert.equal(item.styleId, 'new-style');
        assert.equal(item.styleComboId, 'new-combo');
    }
    assert.deepEqual(payload.shipments[0].orderItems.map(item => item.quantity), [400, 200]);
    assert.deepEqual(fixture.shipments[0].shipmentDate, { daysFromToday: 30, utcOffsetMinutes: 360 });
    const minimal = ctx.buildPurchaseOrderPayload('new-style');
    assert.equal(minimal.currency, 'USD');
    assert.equal(minimal.styles[0].styleId, 'new-style');
});

test('purchase payload rejects a missing or unsupported order currency before HTTP submission', () => {
    for (const currency of [undefined, '', 'INVALID']) {
        const data = { ...fixture, currency };
        const ctx = vm.createContext({ __ENV: {}, purchaseFixturePath, open: () => JSON.stringify(data), uniqueId: () => 'unique', http: {}, check() {}, shipmentDate,
            requiredEnvValue: () => 'synthetic-id' });
        vm.runInContext(readFileSync('k6/flows/purchase-order.js', 'utf8').replace(/import[^\n]+\n/g, '').replace(/^export /gm, ''), ctx);
        assert.throws(() => ctx.buildPurchaseOrderPayload('style', 'combo'), /supported purchase-order currency/);
    }
});


test('production purchase uses its own fixture and fresh workflow dependencies', () => {
    const env = { TEST_ENV: 'prod', LUMINAR_BUYER_ID: 'prod-buyer', LUMINAR_PAYMENT_PROVIDER_ID: 'prod-provider' };
    const ctx = vm.createContext({ __ENV: env, purchaseFixturePath,
        open: path => readFileSync(`k6/flows/${path}`, 'utf8'), uniqueId: () => 'unique',
        shipmentDate: value => shipmentDate(value, Date.parse('2026-10-23T00:00:00Z')),
        requiredEnvValue: key => { assert.ok(env[key]); return env[key]; },
    });
    vm.runInContext(readFileSync('k6/flows/purchase-order.js', 'utf8').replace(/^import [^\n]+\n/gm, '').replace(/^export /gm, ''), ctx);
    const payload = JSON.parse(JSON.stringify(ctx.buildPurchaseOrderPayload('new-style', 'new-combo', 'run')));
    assert.equal(payload.buyerId, 'prod-buyer');
    assert.equal(payload.paymentProviderId, 'prod-provider');
    assert.equal(payload.buyerPoNumber, 'BPO-run-unique');
    assert.equal(payload.brandId, '52a7cf83-9067-4663-991b-bb74528fff84');
    assert.equal(payload.buyerDepartmentId, '7e1c52f9-97b3-40a2-8611-f4188609d190');
    assert.deepEqual(payload.styles, [{ styleId: 'new-style', selectedStyleComboIds: ['new-combo'] }]);
    assert.equal(payload.shipments[0].shipmentDate, '2026-11-22');
    assert.equal(payload.shipments[0].portOfDestination, 'Singapore');
    for (const item of payload.shipments[0].orderItems) {
        assert.equal(item.styleId, 'new-style');
        assert.equal(item.styleComboId, 'new-combo');
        assert.equal(item.quantity, 500);
        assert.equal(item.unitPrice, 11);
    }
});
