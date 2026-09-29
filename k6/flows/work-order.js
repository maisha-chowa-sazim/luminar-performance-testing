import http from 'k6/http';
import { check } from 'k6';
import { approveResource } from '../helpers/approvals.js';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const workOrderFixture = JSON.parse(open('../data/work-order.json'));

function getEnvValue(name, fallback = '') {
    return String(__ENV[name] ?? fallback).trim();
}

export function buildWorkOrderPayload(reservationId, purchaseOrderId = '', styleId = '') {
    const payload = JSON.parse(JSON.stringify(workOrderFixture));

    return {
        ...payload,
        reservationId,
        buyerId: getEnvValue('LUMINAR_BUYER_ID', payload.buyerId),
        items: payload.items.map((item) => ({
            ...item,
            variants: item.variants.map((variant) => ({
                ...variant,
                ...(purchaseOrderId ? { purchaseOrderId } : {}),
                ...(styleId ? { styleId } : {}),
            })),
        })),
    };
}

export function createWorkOrder(token, purchaseOrderId = '', styleId = '') {
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
        console.error(`Work-order number reservation failed: ${reservationResp.status} ${reservationResp.body}`);
        return null;
    }

    const reservationId = reservationResp.json()?.data?.id;
    if (!check(reservationId, {
        'work-order reservation returns an ID': (id) => typeof id === 'string' && id.length > 0,
    })) {
        console.error('Work-order creation skipped: reservation response has no ID.');
        return null;
    }
    const payload = buildWorkOrderPayload(reservationId, purchaseOrderId, styleId);
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
        console.error(`Work-order create failed: ${resp.status} ${resp.body}`);
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
        console.error(`Could not read created work-order ID: ${resp?.status} ${resp?.body}`);
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
        console.error(`Could not read created work-order item variant ID: ${resp?.status} ${resp?.body}`);
    }

    return variantId;
}

export function approveWorkOrder(token, workOrderId) {
    return approveResource({
        token,
        resourceType: 'work-order',
        resourceId: workOrderId,
        feedback: 'Approved by k6 work-order flow',
    });
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
        console.error(`Work-order status update failed: ${resp.status} ${resp.body}`);
    }

    return resp;
}
