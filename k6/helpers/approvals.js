import http from 'k6/http';
import { check } from 'k6';
import { tenantHeaders, getApiUrl } from './http.js';

const RESOURCE_TYPE_MAP = {
    purchase: 'PURCHASE_ORDER',
    bom: 'BOM',
    'pre-costing': 'COSTING',
    'work-order': 'WORK_ORDER',
};

export function buildApprovalPayload(feedback = 'Approved by k6 pipeline') {
    return { feedback };
}

export function approveResource({ token, resourceType, resourceId, feedback = 'Approved by k6 pipeline' }) {
    const normalizedType = RESOURCE_TYPE_MAP[resourceType] || resourceType;
    const payload = buildApprovalPayload(feedback);
    const url = getApiUrl(`/api/v1/approvals/${normalizedType}/${resourceId}/approve`);

    const resp = http.post(url, JSON.stringify(payload), {
        headers: tenantHeaders(token),
        tags: {
            feature: 'approval',
            endpoint: 'approve',
            name: `approval_${normalizedType.toLowerCase()}`,
        },
    });

    const ok = check(resp, {
        'approval status is 201': (r) => r.status === 201,
        'approval returns success payload': (r) => {
            try {
                const body = r.json();
                return body?.success === true || body?.message === 'Approval submitted successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Approval failed for ${normalizedType} ${resourceId}: ${resp.status} ${resp.body}`);
    }

    return resp;
}
