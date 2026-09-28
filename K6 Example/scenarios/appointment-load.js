import { sleep } from 'k6';
import { getProfile } from '../config/profiles.js';
import { appointment } from '../flows/appointment.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: getProfile(),
    thresholds: {
        http_req_failed: ['rate<0.01'],

        'http_req_duration{feature:appointment, endpoint:filter}': ['p(95)<800'],
        'http_req_duration{feature:appointment, endpoint:show}': ['p(95)<500'],
        'http_req_duration{feature:appointment, endpoint:documents}': ['p(95)<500'],
        'http_req_duration{feature:appointment, endpoint:update}': ['p(95)<800'],
    },
};

export default function (data) {
    appointment(data.token);
    sleep(1);
}
