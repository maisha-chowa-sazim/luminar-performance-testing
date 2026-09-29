import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const preCostingFixture = JSON.parse(open('../data/pre-costing.json'));

export function buildPreCostingPayload() {
    return {
        ...JSON.parse(JSON.stringify(preCostingFixture)),
        costingType: 'PRE_COSTING',
    };
}

export function createPreCosting(token, styleId) {
    const hasStyleId = check(styleId, {
        'pre-costing style ID is provided': (value) => typeof value === 'string' && value.length > 0,
    });

    if (!hasStyleId) {
        console.error('Pre-costing create skipped: pass the ID of a newly created style.');
        return null;
    }

    const payload = buildPreCostingPayload();
    const resp = http.post(
        getApiUrl(`/api/v1/styles/${styleId}/costings`),
        JSON.stringify(payload),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'pre-costing', endpoint: 'createPreCosting', name: 'pre_costing_create' },
        },
    );

    const ok = check(resp, {
        'pre-costing create status is 201': (r) => r.status === 201,
        'pre-costing create returns success payload': (r) => {
            try {
                const body = r.json();
                return body?.success === true || body?.message === 'Costing created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Pre-costing create failed: ${resp.status} ${resp.body}`);
    }

    return resp;
}
