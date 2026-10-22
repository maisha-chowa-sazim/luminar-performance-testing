import execution from 'k6/execution';
import { accounts, authenticateAccount, validateAccounts } from '../../helpers/session-pool.js';

const maxDuration = __ENV.LOGIN_MAX_DURATION;
if (!maxDuration?.trim()) throw new Error('LOGIN_MAX_DURATION is required');

export const options = {
    scenarios: {
        login_all_users: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 41,
            maxDuration,
        },
    },
    thresholds: {
        checks: ['rate==1'],
        iterations: ['count==41'],
        // Retryable 429s remain visible, but final authentication decides success.
        'http_reqs{status:429}': [],
    },
};

export function setup() {
    validateAccounts();
}

export default function () {
    authenticateAccount(accounts[execution.scenario.iterationInTest]);
}
