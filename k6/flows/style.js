import { uniqueId } from '../helpers/unique-id.js';
import http from 'k6/http';
import { check } from 'k6';
import { requiredEnvValue } from '../helpers/http.js';

const styleFixture = JSON.parse(open('../data/style.json'));

export function buildStylePayload(runId = '') {
    const suffix = uniqueId();
    const base = JSON.parse(JSON.stringify(styleFixture));

    return {
        ...base,
        name: `${base.name} ${runId ? `${runId} ` : ''}${suffix}`,
        buyerId: requiredEnvValue('LUMINAR_BUYER_ID'),
    };
}

export function createStyle(token, runId = '') {
    const baseUrl = requiredEnvValue('BASE_URL');
    const factoryId = requiredEnvValue('LUMINAR_FACTORY_ID');
    const organizationId = requiredEnvValue('LUMINAR_ORGANIZATION_ID');
    const payload = buildStylePayload(runId);

    const resp = http.post(`${baseUrl}/api/v1/styles`, JSON.stringify(payload), {
        headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'x-factory-id': factoryId,
            'x-organization-id': organizationId,
        },
        tags: { feature: 'style', endpoint: 'createStyle', name: 'style_create' },
    });

    const ok = check(resp, {
        'style create status is 201': (r) => r.status === 201,
        'style create returns success payload': (r) => {
            try {
                const body = r.json();
                return body?.success === true || body?.message === 'Style created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Style create failed: ${resp.status} [response redacted]`);
    }

    return resp;
}

export function getCreatedStyleId(resp) {
    let styleId = null;

    try {
        styleId = resp?.json()?.data?.id || null;
    } catch (err) {
        styleId = null;
    }

    const ok = check(styleId, {
        'style create returns an ID': (id) => typeof id === 'string' && id.length > 0,
    });

    if (!ok) {
        console.error(`Could not read created style ID: ${resp?.status} [response redacted]`);
    }

    return styleId;
}

export function getStyleDetails(token, styleId) {
    const baseUrl = requiredEnvValue('BASE_URL');
    const factoryId = requiredEnvValue('LUMINAR_FACTORY_ID');
    const organizationId = requiredEnvValue('LUMINAR_ORGANIZATION_ID');
    const resp = http.get(`${baseUrl}/api/v1/styles/${styleId}`, {
        headers: {
            Accept: 'application/json, text/plain, */*',
            Authorization: `Bearer ${token}`,
            'x-factory-id': factoryId,
            'x-organization-id': organizationId,
        },
        tags: { feature: 'style', endpoint: 'getStyle', name: 'style_get' },
    });

    const ok = check(resp, {
        'style details status is 200': (r) => r.status === 200,
        'style details returns success payload': (r) => {
            try {
                return r.json()?.success === true;
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Style details failed: ${resp.status} [response redacted]`);
        return null;
    }

    return resp.json()?.data || null;
}
