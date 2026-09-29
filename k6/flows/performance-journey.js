import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import journey from '../scenarios/full-journey.js';
import { setupAuth } from '../helpers/auth.js';

const started = new Counter('journey_started');
const completed = new Counter('journey_completed');
const success = new Rate('journey_success');
const duration = new Trend('journey_duration', true);
const thinkTime = Number(__ENV.THINK_TIME_SECONDS || 3);
if (!Number.isFinite(thinkTime) || thinkTime < 0) throw new Error('THINK_TIME_SECONDS must be non-negative');

export function setup() {
    const required = ['BASE_URL', 'LUMINAR_FACTORY_ID', 'LUMINAR_ORGANIZATION_ID', 'LUMINAR_BUYER_ID'];
    for (const role of ['MERCHANDISER', 'EXECUTIVE', 'SENIOR_MERCHANDISER', 'INVENTORY']) {
        required.push(`${role}_EMAIL`, `${role}_PASSWORD`);
    }
    for (const key of required) if (!String(__ENV[key] || '').trim()) throw new Error(`Missing ${key}`);
    return setupAuth();
}

export default function (data) {
    started.add(1);
    completed.add(0);
    const start = Date.now();
    let ok = false;
    try {
        ok = journey(data) === true;
    } finally {
        success.add(ok);
        if (ok) completed.add(1);
        duration.add(Date.now() - start);
        // Pace failures as well as successful iterations to avoid retry storms.
        sleep(thinkTime);
    }
}
