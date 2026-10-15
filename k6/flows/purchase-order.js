import { uniqueId } from '../helpers/unique-id.js';
import http from 'k6/http';
import { check } from 'k6';
import { requiredEnvValue } from '../helpers/http.js';

export function buildPurchaseOrderPayload(styleIdOverride = '', styleComboIdOverride = '') {
    const styleId = styleIdOverride || requiredEnvValue('LUMINAR_STYLE_ID');
    const buyerId = requiredEnvValue('LUMINAR_BUYER_ID');

    if (styleIdOverride && !styleComboIdOverride) {
        return {
            buyerId,
            buyerPoNumber: `K6-${uniqueId()}`,
            styles: [{ styleId }],
        };
    }

    const styleComboId = styleComboIdOverride || requiredEnvValue('LUMINAR_STYLE_COMBO_ID');
    return {
        buyerId,
        buyerPoNumber: `BPO-${uniqueId()}`,
        paymentProviderId: requiredEnvValue('LUMINAR_PAYMENT_PROVIDER_ID'),
        styles: [{ styleId, selectedStyleComboIds: styleComboIdOverride ? [styleComboId] : [] }],
        teamId: null,
        productionFlow: ['CUTTING', 'SEWING', 'FINISHING', 'PACKING'],
        shipments: [
            {
                shipmentMode: 'AIR',
                shipmentDate: requiredEnvValue('LUMINAR_SHIPMENT_DATE'),
                portOfDestination: 'Constanta',
                deliveryNumber: null,
                orderItems: [
                    {
                        styleId,
                        styleComboId,
                        size: 'M',
                        quantity: 400,
                        unitPriceCurrency: 'USD',
                        unitPrice: 5,
                    },
                    {
                        styleId,
                        styleComboId,
                        size: 'L',
                        quantity: 200,
                        unitPriceCurrency: 'USD',
                        unitPrice: 5,
                    },
                ],
            },
        ],
        status: 'PENDING_APPROVAL',
    };
}

export function createPurchaseOrder(token, styleId = '', styleComboId = '') {
    const baseUrl = requiredEnvValue('BASE_URL');
    const factoryId = requiredEnvValue('LUMINAR_FACTORY_ID');
    const organizationId = requiredEnvValue('LUMINAR_ORGANIZATION_ID');
    const payload = buildPurchaseOrderPayload(styleId, styleComboId);
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
        console.error(`Purchase order create failed: ${resp.status} ${resp.body}`);
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
        console.error(`Could not read created purchase order ID: ${resp?.status} ${resp?.body}`);
    }

    return orderId;
}