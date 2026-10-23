import { uniqueId } from '../helpers/unique-id.js';
import http from 'k6/http';
import { check } from 'k6';
import { requiredEnvValue } from '../helpers/http.js';
import { shipmentDate } from '../helpers/shipment-date.mjs';
import { purchaseFixturePath } from '../config/environment.mjs';

const purchaseFixture = JSON.parse(open(purchaseFixturePath(__ENV)));

export function buildPurchaseOrderPayload(styleIdOverride = '', styleComboIdOverride = '', runId = '') {
    const styleId = styleIdOverride || requiredEnvValue('LUMINAR_STYLE_ID');
    const buyerId = requiredEnvValue('LUMINAR_BUYER_ID');
    const currency = purchaseFixture.currency;
    if (!['USD', 'BDT', 'EUR', 'CNY', 'INR'].includes(currency)) {
        throw new Error('Selected purchase fixture must define a supported purchase-order currency');
    }

    if (styleIdOverride && !styleComboIdOverride) {
        return {
            buyerId,
            currency,
            buyerPoNumber: `K6-${runId ? `${runId}-` : ''}${uniqueId()}`,
            styles: [{ styleId }],
        };
    }

    const styleComboId = styleComboIdOverride || requiredEnvValue('LUMINAR_STYLE_COMBO_ID');
    const payload = JSON.parse(JSON.stringify(purchaseFixture));
    return {
        ...payload,
        buyerId,
        currency,
        buyerPoNumber: `BPO-${runId ? `${runId}-` : ''}${uniqueId()}`,
        paymentProviderId: requiredEnvValue('LUMINAR_PAYMENT_PROVIDER_ID'),
        styles: [{ styleId, selectedStyleComboIds: styleComboIdOverride ? [styleComboId] : [] }],
        shipments: payload.shipments.map(shipment => ({
            ...shipment,
            shipmentDate: shipmentDate(shipment.shipmentDate),
            orderItems: shipment.orderItems.map(item => ({ ...item, styleId, styleComboId })),
        })),
    };
}

export function createPurchaseOrder(token, styleId = '', styleComboId = '', runId = '') {
    const baseUrl = requiredEnvValue('BASE_URL');
    const factoryId = requiredEnvValue('LUMINAR_FACTORY_ID');
    const organizationId = requiredEnvValue('LUMINAR_ORGANIZATION_ID');
    const payload = buildPurchaseOrderPayload(styleId, styleComboId, runId);
    const activeToken = token || __ENV.SAVED_SESSION_TOKEN;

    const resp = http.post(`${baseUrl}/api/v1/purchase-orders`, JSON.stringify(payload), {
        headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeToken}`,
            'x-factory-id': factoryId,
            'x-organization-id': organizationId,
        },
        tags: { feature: 'purchase-order', endpoint: 'createPurchaseOrder', name: 'purchase_order_create' },
    });

    const ok = check(resp, {
        'purchase order status is 201': (r) => r.status === 201,
        'purchase order returns success payload': (r) => {
            try {
                const body = r.json();
                return body?.success === true || body?.message === 'Purchase order created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Purchase order create failed: ${resp.status} [response redacted]`);
    }

    return resp;
}

export function getCreatedPurchaseOrderId(resp) {
    let orderId = null;

    try {
        orderId = resp?.json()?.data?.id || null;
    } catch (err) {
        orderId = null;
    }

    const ok = check(orderId, {
        'purchase order create returns an ID': (id) => typeof id === 'string' && id.length > 0,
    });

    if (!ok) {
        console.error(`Could not read created purchase order ID: ${resp?.status} [response redacted]`);
    }

    return orderId;
}
