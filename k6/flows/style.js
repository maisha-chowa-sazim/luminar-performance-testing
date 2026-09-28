import http from 'k6/http';
import { check } from 'k6';

const styleFixture = JSON.parse(open('../data/style.json'));

function getEnvValue(name, fallback = '') {
    return String(__ENV[name] ?? fallback).trim();
}

export function buildStylePayload() {
    const suffix = Date.now();
    const base = JSON.parse(JSON.stringify(styleFixture));

    return {
        ...base,
        name: `${base.name} ${suffix}`,
        buyerId: getEnvValue('LUMINAR_BUYER_ID', base.buyerId),
        garmentSizeTemplateId: getEnvValue('LUMINAR_GARMENT_SIZE_TEMPLATE_ID', base.garmentSizeTemplateId),
    };
}

export function createStyle(token) {
    const baseUrl = getEnvValue('BASE_URL', 'http://localhost:5000');
    const factoryId = getEnvValue('LUMINAR_FACTORY_ID', '2f7e5d9a-3c1b-4e8f-9a6d-1b2c3d4e5f60');
    const organizationId = getEnvValue('LUMINAR_ORGANIZATION_ID', '0e3c4b48-c231-4252-9be7-aafb4a647d05');
    const payload = buildStylePayload();

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
        console.error(`Style create failed: ${resp.status} ${resp.body}`);
    }

    return resp;
}
