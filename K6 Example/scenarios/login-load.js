import { sleep } from 'k6';
import { getProfile } from '../config/profiles.js';
import { login } from '../helpers/auth.js';

export const options = {
    stages: getProfile(),
    thresholds: {
        http_req_failed: ['rate<0.01'],
        'http_req_duration{feature:login}': ['p(95)<500'],
    },
};

export default function () {
    login();
    sleep(1);
}
