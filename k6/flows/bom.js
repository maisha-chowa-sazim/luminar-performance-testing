import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const bomFixture = JSON.parse(open('../data/bom.json'));

export function buildBomPayload(styleComboId = '') {
    const payload = JSON.parse(JSON.stringify(bomFixture));

    if (styleComboId) {
        payload.fabricEntries = payload.fabricEntries.map(({ id, compositions, ...entry }) => ({
            ...entry,
            comboId: styleComboId,
            compositions: compositions.map(({ id: compositionId, ...composition }) => composition),
        }));
    }

    return payload;
}

export function createBom(token, styleId, styleComboId) {
    const hasStyleId = check(styleId, {
        'BOM style ID is provided': (value) => typeof value === 'string' && value.length > 0,
    });
    const hasStyleComboId = check(styleComboId, {
        'BOM style combo ID is provided': (value) => typeof value === 'string' && value.length > 0,
    });

    if (!hasStyleId || !hasStyleComboId) {
        console.error('BOM create skipped: pass a newly created style ID and one of its combo IDs.');
        return null;
    }

    const payload = buildBomPayload(styleComboId);
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

export function getCreatedBomId(resp) {
    let bomId = null;

    try {
        bomId = resp?.json()?.data?.id || null;
    } catch (err) {
        bomId = null;
    }

    const ok = check(bomId, {
        'BOM create returns an ID': (id) => typeof id === 'string' && id.length > 0,
    });

    if (!ok) {
        console.error(`Could not read created BOM ID: ${resp?.status} ${resp?.body}`);
    }

    return bomId;
}
