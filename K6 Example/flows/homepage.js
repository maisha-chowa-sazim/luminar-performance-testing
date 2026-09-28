import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/env.js';

export function homepage() {
    const baseTags = { feature: 'homepage' };

    const resp = http.get(BASE_URL, {
        tags: { ...baseTags, endpoint: 'index', name: 'homepage_index' },
    });

    check(resp, {
        'homepage status is 200': (r) => r.status === 200,
    });
}
