import { sleep } from 'k6';
import { getSmokeProfile } from '../config/profiles.js';
import { setupAuth } from '../helpers/auth.js';
import { createPurchaseOrder } from '../flows/purchase-order.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: getSmokeProfile(),
    thresholds: {
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<3000'],
    },
};

export default function (data) {
    const token = data?.token || __ENV.SAVED_SESSION_TOKEN || '';
    createPurchaseOrder(token);
    sleep(1);
}
