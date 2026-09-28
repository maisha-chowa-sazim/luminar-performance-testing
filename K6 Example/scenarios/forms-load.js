import { sleep } from 'k6';
import { getProfile } from '../config/profiles.js';
import { forms } from '../flows/forms.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: getProfile(),
    thresholds: {
        http_req_failed: ['rate<0.01'],

        'http_req_duration{feature:forms, endpoint:create_or_update_diagnostic_imaging_form}': ['p(95)<2000'],
        'http_req_duration{feature:forms, endpoint:preview_pdf}': ['p(95)<2000'],
    },
};

export default function (data) {
    forms(data.token);
    sleep(1);
}
