import { sleep } from 'k6';
import { getProfile } from '../config/profiles.js';
import { providers } from '../flows/providers.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: getProfile(),
    thresholds: {
        http_req_failed: ['rate<0.01'],

        'http_req_duration{feature:providers, endpoint:index}': ['p(95)<800'],
    },
};

export default function (data) {
    providers(data.token);
    sleep(1);
}
