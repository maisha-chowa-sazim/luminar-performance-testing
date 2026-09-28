import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/env.js';
import { authHeaders } from '../helpers/http.js';
import { TEST_DATA } from '../data/test-data.js';

export function dashboard(token) {
    const headers = authHeaders(token);
    const baseTags = { feature: 'dashboard' };

    const dashResp = http.get(
        `${BASE_URL}/api/v1/appointment_dashboards?dashboard_type=provider_id&only_favorites=false&timezone=${encodeURIComponent(TEST_DATA.timezone)}`,
        { headers, tags: { ...baseTags, endpoint: 'index', name: 'dashboard_index' } },
    );
    check(dashResp, {
        'appointment_dashboards status is 200': (r) => r.status === 200,
    });
}
