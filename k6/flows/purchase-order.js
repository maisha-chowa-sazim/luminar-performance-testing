import http from 'k6/http';
import { check } from 'k6';
import { approveResource } from '../helpers/approvals.js';

function getEnvValue(name, fallback = '') {
    return String(__ENV[name] ?? fallback).trim();
}

export function buildPurchaseOrderPayload(styleIdOverride = '', styleComboIdOverride = '') {
    const styleId = styleIdOverride || getEnvValue('LUMINAR_STYLE_ID', '570928a2-4720-48b5-a608-91048b2c5d7a');
    const buyerId = getEnvValue('LUMINAR_BUYER_ID', '05f2b123-1eff-4afb-b6e2-163c610cbe29');
    const styleComboId = styleComboIdOverride || getEnvValue('LUMINAR_STYLE_COMBO_ID', '5d6c66a8-729d-430e-b790-da534e68ab14');

    if (styleIdOverride && !styleComboIdOverride) {
        return {
            buyerId,
            buyerPoNumber: `K6-${Date.now()}`,
            styles: [{ styleId }],
        };
    }

    return {
        buyerId,
        buyerPoNumber: `BPO-${Date.now()}`,
        paymentProviderId: getEnvValue('LUMINAR_PAYMENT_PROVIDER_ID', '2e303013-2d02-45a4-a1be-77c52a064589'),
        styles: [{ styleId, selectedStyleComboIds: styleComboIdOverride ? [styleComboId] : [] }],
        teamId: null,
        productionFlow: ['CUTTING', 'SEWING', 'FINISHING', 'PACKING'],
        shipments: [
            {
                shipmentMode: 'AIR',
                shipmentDate: '2026-09-28',
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
    const baseUrl = getEnvValue('BASE_URL');
    const factoryId = getEnvValue('LUMINAR_FACTORY_ID');
    const organizationId = getEnvValue('LUMINAR_ORGANIZATION_ID');
    const payload = buildPurchaseOrderPayload(styleId, styleComboId);
    const activeToken = token || __ENV.SAVED_SESSION_TOKEN || '';

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


// export function purchaseApproval(token, resourceId, feedback = 'Approved by k6 purchase flow') {
//     return approveResource({
//         token,
//         resourceType: 'purchase',
//         resourceId,
//         feedback,
//     });
// }