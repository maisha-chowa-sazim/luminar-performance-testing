import { uniqueId } from '../helpers/unique-id.js';
import http from 'k6/http';
import { check } from 'k6';
import { receiveItemFixturePath } from '../config/environment.mjs';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const receiveItemFixture = JSON.parse(open(receiveItemFixturePath(__ENV)));

export function buildReceiveItemPayload(workOrderId, poItemVariantId) {
    const payload = JSON.parse(JSON.stringify(receiveItemFixture));

    const variantIds = Array.isArray(poItemVariantId) ? poItemVariantId : [poItemVariantId];
    if (variantIds.length !== payload.items.length || variantIds.some(id => typeof id !== 'string' || !id)) {
        throw new Error('Provide one fresh variant ID per receive-item fixture row');
    }

    return {
        ...payload,
        workOrderId,
        grnNumber: `GRN-K6-${uniqueId()}`,
        receivedAt: new Date().toISOString(),
        items: payload.items.map((item, index) => ({
            ...item,
            poItemVariantId: variantIds[index],
        })),
    };
}

export function createReceiveItem(token, workOrderId, poItemVariantId) {
    const hasWorkOrderId = check(workOrderId, {
        'receipt work-order ID is provided': (value) => typeof value === 'string' && value.length > 0,
    });
    const hasVariantId = check(poItemVariantId, {
        'receipt item variant ID is provided': (value) => Array.isArray(value)
            ? value.length > 0 && value.every(id => typeof id === 'string' && id.length > 0)
            : typeof value === 'string' && value.length > 0,
    });

    if (!hasWorkOrderId || !hasVariantId) {
        console.error('GRN create skipped: pass the created work-order ID and one of its item variant IDs.');
        return null;
    }

    const payload = buildReceiveItemPayload(workOrderId, poItemVariantId);
    const resp = http.post(
        getApiUrl('/api/v1/grn'),
        JSON.stringify(payload),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'accessory-grn', endpoint: 'createGrn', name: 'grn_create' },
        },
    );

    const ok = check(resp, {
        'GRN create status is 201': (r) => r.status === 201,
        'GRN create returns success payload': (r) => {
            try {
                return r.json()?.success === true || r.json()?.message === 'GRN created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`GRN create failed: ${resp.status} [response redacted]`);
    }

    return resp;
}