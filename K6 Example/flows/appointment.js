import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/env.js';
import { authHeaders, jsonHeaders } from '../helpers/http.js';
import { TEST_DATA } from '../data/test-data.js';

export function appointment(token) {
    const headers = authHeaders(token);
    const baseTags = { feature: 'appointment' };
    const uuid = TEST_DATA.appointmentUuid;

    const filterResp = http.get(
        `${BASE_URL}/api/v1/appointments/filter?pathway=vuns811&appointment_state=requested`,
        { headers, tags: { ...baseTags, endpoint: 'filter', name: 'appointment_filter' } },
    );

    check(filterResp, {
        'appointment filter status is 200': (r) => r.status === 200,
    });

    const showResp = http.get(
        `${BASE_URL}/api/v1/appointments/${uuid}`,
        { headers, tags: { ...baseTags, endpoint: 'show', name: 'appointment_show' } },
    );

    check(showResp, {
        'appointment show status is 200': (r) => r.status === 200,
    });

    const docsResp = http.get(
        `${BASE_URL}/api/v1/appointments/${uuid}/documents`,
        { headers, tags: { ...baseTags, endpoint: 'documents', name: 'appointment_documents' } },
    );

    check(docsResp, {
        'appointment documents status is 200': (r) => r.status === 200,
    });

    const updateResp = http.put(
        `${BASE_URL}/api/v1/appointments/${uuid}`,
        JSON.stringify({ appointment: { event: 'start_visit' } }),
        { headers: jsonHeaders(token), tags: { ...baseTags, endpoint: 'update', name: 'appointment_update' } },
    );

    check(updateResp, {
        'appointment update status is 200': (r) => r.status === 200,
    });
}
