import { sleep } from 'k6';
import { homepage } from '../flows/homepage.js';
import { dashboard } from '../flows/dashboard.js';
import { providers } from '../flows/providers.js';
import { chat } from '../flows/chat.js';
import { appointment } from '../flows/appointment.js';
import { forms } from '../flows/forms.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: [{ duration: '30s', target: 5 }],
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<2000'],
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
