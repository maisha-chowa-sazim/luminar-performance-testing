import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const bomFixture = JSON.parse(open('../data/bom.json'));

export function buildBomPayload() {
    return JSON.parse(JSON.stringify(bomFixture));
}

export function createBom(token, styleId) {
    const hasStyleId = check(styleId, {
        'BOM style ID is provided': (value) => typeof value === 'string' && value.length > 0,
    });

    if (!hasStyleId) {
        console.error('BOM create skipped: pass the ID of a newly created style.');
        return null;
    }

    const payload = buildBomPayload();
    const resp = http.post(
        getApiUrl(`/api/v1/styles/${styleId}/boms`),
        JSON.stringify(payload),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'bom', endpoint: 'createBom', name: 'bom_create' },
        },
    );

    const ok = check(resp, {
        'BOM create status is 201': (r) => r.status === 201,
        'BOM create returns success payload': (r) => {
            try {
                const body = r.json();
                return body?.success === true || body?.message === 'BOM created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`BOM create failed: ${resp.status} ${resp.body}`);
    }

    return resp;
}
