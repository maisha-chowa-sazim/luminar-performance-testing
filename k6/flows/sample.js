import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const sampleFixture = JSON.parse(open('../data/sample.json'));

export function buildSamplePayload() {
    return JSON.parse(JSON.stringify(sampleFixture));
}

export function createSample(token, styleId) {
    const hasStyleId = check(styleId, {
        'sample style ID is provided': (value) => typeof value === 'string' && value.length > 0,
    });

    if (!hasStyleId) {
        console.error('Sample create skipped: pass the ID of a newly created style.');
        return null;
    }

    const payload = buildSamplePayload();
    const resp = http.post(
        getApiUrl(`/api/v1/styles/${styleId}/sample-coordination`),
        JSON.stringify(payload),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'sample', endpoint: 'createSample', name: 'sample_create' },
        },
    );

    const ok = check(resp, {
        'sample create status is 201': (r) => r.status === 201,
        'sample create returns success payload': (r) => {
            try {
                const body = r.json();
                return body?.success === true || body?.message === 'Sample coordination created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Sample create failed: ${resp.status} ${resp.body}`);
    }

    return resp;
}
