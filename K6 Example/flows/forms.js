import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/env.js';
import { jsonHeaders, authHeaders } from '../helpers/http.js';
import { TEST_DATA, APPOINTMENT_FORM_PAYLOAD } from '../data/test-data.js';

export function forms(token) {
    const baseTags = { feature: 'forms' };

    const payload = APPOINTMENT_FORM_PAYLOAD;

    const resp = http.post(
        `${BASE_URL}/api/v1/filled_appointment_forms/create_or_update_diagnostic_imaging_form`,
        JSON.stringify(payload),
        { headers: jsonHeaders(token), tags: { ...baseTags, endpoint: 'create_or_update_diagnostic_imaging_form', name: 'forms_di_form' } },
    );

    check(resp, {
        'DI form status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });

    const previewResp = http.get(
        `${BASE_URL}/api/v1/diagnostic_reports/${TEST_DATA.appointmentUuid}/preview_pdf`,
        { headers: authHeaders(token), tags: { ...baseTags, endpoint: 'preview_pdf', name: 'diagnostic_reports_preview_pdf' } },
    );

    check(previewResp, {
        'diagnostic report preview_pdf status is 200': (r) => r.status === 200,
    });
}
