import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl, requiredEnvValue, tenantHeaders } from '../helpers/http.js';

const workOrderFixture = JSON.parse(open('../data/work-order.json'));

export function buildWorkOrderPayload(reservationId, purchaseOrderId = '', styleId = '', purchaseOrder = null) {
    const payload = JSON.parse(JSON.stringify(workOrderFixture));
    if (!['USD', 'BDT', 'EUR', 'CNY', 'INR'].includes(payload.currency)) {
        throw new Error('k6/data/work-order.json must define a supported work-order currency');
    }
    const linked = Boolean(purchaseOrderId || styleId);
    if (linked && (!purchaseOrderId || !styleId || purchaseOrder?.id !== purchaseOrderId || !Array.isArray(purchaseOrder.orderItems))) {
        throw new Error('Matching purchase-order details and style ID are required for work-order creation');
    }

    return {
        ...payload,
        reservationId,
        buyerId: requiredEnvValue('LUMINAR_BUYER_ID'),
        items: payload.items.map((item) => ({
            ...item,
            variants: item.variants.map((variant) => {
                if (!linked) return variant;
                const sizes = variant.garmentSizes;
                if (!Array.isArray(sizes) || !sizes.length) throw new Error('Work-order variant requires garmentSizes');
                const candidates = purchaseOrder.orderItems.filter(row => row.style?.id === styleId && sizes.includes(row.size));
                if (!sizes.every(size => candidates.some(row => row.size === size))) {
                    throw new Error('Work-order garment style/sizes do not match the purchase order');
                }
                const colors = [...new Set(candidates.map(row => row.color))];
                const color = colors.includes(variant.garmentColor) ? variant.garmentColor : colors.length === 1 ? colors[0] : null;
                if (typeof color !== 'string' || !color) throw new Error('Work-order garment color is missing or ambiguous in the purchase order');
                const rows = candidates.filter(row => row.color === color);
                if (!sizes.every(size => rows.some(row => row.size === size)) ||
                    rows.some(row => !Number.isFinite(row.quantity) || row.quantity <= 0)) {
                    throw new Error('Work-order garment sizes/quantities do not match the purchase order');
                }
                const garments = rows.reduce((sum, row) => sum + row.quantity, 0);
                const consumption = Number(variant.consumption), wastage = Number(variant.wastagePercentage ?? 0);
                if (!Number.isFinite(consumption) || consumption <= 0 || !Number.isFinite(wastage) || wastage < 0) {
                    throw new Error('Work-order consumption and wastage must be valid non-negative decimals');
                }
                const quantity = Number((garments * consumption * (1 + wastage / 100)).toFixed(4));
                if (quantity <= 0) throw new Error('Calculated work-order material quantity must be positive');
                // The old group UUID belongs to unrelated fixture data. This field
                // is optional in the create contract; let the API assign grouping.
                const { variantGroupId, ...fields } = variant;
                return { ...fields, purchaseOrderId, styleId, garmentColor: color,
                    garmentsQuantity: String(garments), quantity: String(quantity) };
            }),
        })),
    };
}

export function createWorkOrder(token, purchaseOrderId = '', styleId = '') {
    // Validate fixture data before reserving a number, which is a server-side write.
    let payload = buildWorkOrderPayload('');
    let purchaseOrder = null;
    if (purchaseOrderId) {
        const response = http.get(getApiUrl(`/api/v1/purchase-orders/${purchaseOrderId}`), {
            headers: tenantHeaders(token), tags: { feature: 'purchase-order', name: 'purchase_order_get' }, timeout: '30s',
        });
        try {
            const body = response.json();
            if (response.status === 200 && body.success === true) purchaseOrder = body.data;
        } catch { /* Invalid purchase details fail before a reservation is made. */ }
        if (!check(purchaseOrder, { 'work-order purchase details match the created order': value => value?.id === purchaseOrderId })) {
            console.error(`Work-order skipped: purchase-order read failed (HTTP ${response.status})`);
            return null;
        }
    }
    payload = buildWorkOrderPayload('', purchaseOrderId, styleId, purchaseOrder);
    const reservationResp = http.post(
        getApiUrl('/api/v1/work-orders/reserve-number'),
        null,
        {
            headers: tenantHeaders(token),
            tags: { feature: 'work-order', endpoint: 'reserveWorkOrderNumber', name: 'work_order_reserve_number' },
        },
    );

    const reservationOk = check(reservationResp, {
        'work-order reservation status is 201': (r) => r.status === 201,
        'work-order reservation returns success payload': (r) => {
            try {
                return r.json()?.success === true;
            } catch (err) {
                return false;
            }
        },
    });

    if (!reservationOk) {
        console.error(`Work-order number reservation failed: ${reservationResp.status} [response redacted]`);
        return null;
    }

    const reservationId = reservationResp.json()?.data?.id;
    if (!check(reservationId, {
        'work-order reservation returns an ID': (id) => typeof id === 'string' && id.length > 0,
    })) {
        console.error('Work-order creation skipped: reservation response has no ID.');
        return null;
    }
    payload.reservationId = reservationId;
    const resp = http.post(
        getApiUrl('/api/v1/work-orders'),
        JSON.stringify(payload),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'work-order', endpoint: 'createWorkOrder', name: 'work_order_create' },
        },
    );

    const ok = check(resp, {
        'work-order create status is 201': (r) => r.status === 201,
        'work-order create returns success payload': (r) => {
            try {
                return r.json()?.success === true || r.json()?.message === 'Work order created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Work-order create failed: ${resp.status} [response redacted]`);
    }

    return resp;
}

export function getCreatedWorkOrderId(resp) {
    let workOrderId = null;

    try {
        workOrderId = resp?.json()?.data?.id || null;
    } catch (err) {
        workOrderId = null;
    }

    const ok = check(workOrderId, {
        'work-order create returns an ID': (id) => typeof id === 'string' && id.length > 0,
    });

    if (!ok) {
        console.error(`Could not read created work-order ID: ${resp?.status} [response redacted]`);
    }

    return workOrderId;
}

export function getCreatedWorkOrderVariantId(resp) {
    let variantId = null;

    try {
        variantId = resp?.json()?.data?.items?.[0]?.variants?.[0]?.id || null;
    } catch (err) {
        variantId = null;
    }

    const ok = check(variantId, {
        'work-order create returns an item variant ID': (id) => typeof id === 'string' && id.length > 0,
    });

    if (!ok) {
        console.error(`Could not read created work-order item variant ID: ${resp?.status} [response redacted]`);
    }

    return variantId;
}

export function approveWorkOrder(token, workOrderId) {
    const response = http.post(getApiUrl(`/api/v1/approvals/WORK_ORDER/${workOrderId}/approve`),
        JSON.stringify({ feedback: 'Approved by k6 work-order flow' }), {
            headers: tenantHeaders(token), tags: { feature: 'work-order', name: 'approval_work_order' }, timeout: '30s',
        });
    check(response, {
        'work-order approval status is 201': r => r.status === 201,
        'work-order approval returns success': r => { try { return r.json()?.success === true; } catch { return false; } },
    });
    return response;
}

export function sendWorkOrderToSupplier(token, workOrderId) {
    const resp = http.patch(
        getApiUrl(`/api/v1/work-orders/${workOrderId}/status`),
        JSON.stringify({ status: 'SENT_TO_SUPPLIER' }),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'work-order', endpoint: 'updateWorkOrderStatus', name: 'work_order_sent_to_supplier' },
        },
    );

    const ok = check(resp, {
        'work-order sent-to-supplier status is 200': (r) => r.status === 200,
        'work-order sent-to-supplier returns success payload': (r) => {
            try {
                return r.json()?.success === true;
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Work-order status update failed: ${resp.status} [response redacted]`);
    }

    return resp;
}
