import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/env.js';
import { authHeaders } from '../helpers/http.js';

export function providers(token) {
    const headers = authHeaders(token);
    const baseTags = { feature: 'providers' };

    const resp = http.get(
        `${BASE_URL}/api/v1/users/providers`,
        { headers, tags: { ...baseTags, endpoint: 'index', name: 'providers_index' } },
    );

    check(resp, {
        'providers status is 200': (r) => r.status === 200,
    });
}
