import { performanceOptions } from '../config/performance.js';
export { default, setup } from '../flows/performance-journey.js';

const rate = Number(__ENV.JOURNEY_RATE);
const vus = Number(__ENV.JOURNEY_VUS);
const timeUnit = __ENV.JOURNEY_TIME_UNIT;
const duration = __ENV.JOURNEY_DURATION;
if (!Number.isInteger(rate) || rate < 1) throw new Error('JOURNEY_RATE must be a positive integer');
if (!Number.isInteger(vus) || vus < 1 || vus > 20) throw new Error('JOURNEY_VUS must be between 1 and 20');
if (!timeUnit?.trim()) throw new Error('JOURNEY_TIME_UNIT is required');
if (!duration?.trim()) throw new Error('JOURNEY_DURATION is required');
const base = performanceOptions(20);
const thresholds = Object.fromEntries(Object.entries(base.thresholds).map(([key, value]) =>
    [key.replace('scenario:full_journey', 'scenario:arrival_journey'), value]));

export const options = {
    ...base,
    scenarios: {
        arrival_journey: {
            executor: 'constant-arrival-rate', tags: { workload: 'api' },
            rate,
            timeUnit,
            duration,
            preAllocatedVUs: vus,
            gracefulStop: '2m',
        },
    },
    thresholds: { ...thresholds, dropped_iterations: ['count==0'] },
};
