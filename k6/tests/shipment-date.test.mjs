import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shipmentDate } from '../helpers/shipment-date.mjs';

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
    const ctx = vm.createContext({ open: () => JSON.stringify(fixture), uniqueId: () => 'unique', http: {}, check() {},
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
    for (const item of payload.shipments[0].orderItems) {
        assert.equal(item.styleId, 'new-style');
        assert.equal(item.styleComboId, 'new-combo');
    }
    assert.deepEqual(payload.shipments[0].orderItems.map(item => item.quantity), [400, 200]);
    assert.deepEqual(fixture.shipments[0].shipmentDate, { daysFromToday: 30, utcOffsetMinutes: 360 });
});
