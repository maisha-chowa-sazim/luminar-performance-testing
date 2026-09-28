import { sleep } from 'k6';
import { getProfile } from '../config/profiles.js';
import { homepage } from '../flows/homepage.js';
import { dashboard } from '../flows/dashboard.js';
import { providers } from '../flows/providers.js';
import { chat } from '../flows/chat.js';
import { appointment } from '../flows/appointment.js';
import { forms } from '../flows/forms.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: getProfile(),
    thresholds: {
        http_req_failed: ['rate<0.01'],

        'http_req_duration{feature:homepage}': ['p(95)<500'],
        'http_req_duration{feature:dashboard}': ['p(95)<800'],
        'http_req_duration{feature:providers}': ['p(95)<800'],
        'http_req_duration{feature:chat}': ['p(95)<500'],
        'http_req_duration{feature:appointment}': ['p(95)<500'],
        'http_req_duration{feature:forms}': ['p(95)<2000'],
    },
};

export default function (data) {
    homepage();

    dashboard(data.token);
    providers(data.token);
    chat(data.token, data.userId);
    appointment(data.token);
    forms(data.token);

    sleep(1);
}
