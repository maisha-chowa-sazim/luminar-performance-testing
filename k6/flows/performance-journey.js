import { sleep } from 'k6';
import execution from 'k6/execution';
import { setupSessions, sessionsForVU } from '../helpers/session-pool.js';
import { Counter, Rate, Trend } from 'k6/metrics';
import journey from '../scenarios/full-journey.js';
import { requiredEnvValue } from '../helpers/http.js';

const started = new Counter('journey_started');
const completed = new Counter('journey_completed');
const success = new Rate('journey_success');
const duration = new Trend('journey_duration', true);
const thinkTime = Number(__ENV.THINK_TIME_SECONDS);
if (!Number.isFinite(thinkTime) || thinkTime < 0) throw new Error('THINK_TIME_SECONDS must be non-negative');

export function setup() {
    for (const key of [
        'LUMINAR_FACTORY_ID',
        'LUMINAR_ORGANIZATION_ID',
        'LUMINAR_BUYER_ID',
        'LUMINAR_GARMENT_SIZE_TEMPLATE_ID',
        'LUMINAR_PAYMENT_PROVIDER_ID',
    ]) {
        requiredEnvValue(key);
    }
    return setupSessions();
}

export default function (data) {
    started.add(1);
    completed.add(0);
    const start = Date.now();
    let ok = false;
    try {
        ok = journey(sessionsForVU(data, execution.vu.idInTest)) === true;
    } finally {
        success.add(ok);
        if (ok) completed.add(1);
        duration.add(Date.now() - start);
        // Pace failures as well as successful iterations to avoid retry storms.
        if (execution.scenario.name !== 'arrival_journey') sleep(thinkTime);
    }
}
