import { Counter, Rate, Trend, Gauge } from 'k6/metrics';
import { roleConfig, roleOptions } from '../config/role-load.mjs';
import { selectRoleAccounts } from '../helpers/role-accounts.mjs';
import { authenticateAccount } from '../helpers/session-pool.js';
import { requiredEnvValue } from '../helpers/http.js';
import { coordinate, thinkRanges, coordinationErrors, integrityErrors, quantityErrors, duplicateReceipts, duplicateAttempts } from '../helpers/role-runtime.js';

export function createRoleScenario(env) {
    const config = roleConfig(env);
    config.think = thinkRanges(env);
    const options = roleOptions(config);
    const users = JSON.parse(open('../data/users.json'));
    const e2e = new Rate('e2e_success');
    const duration = new Trend('e2e_elapsed_duration', true);
    const handoff = new Trend('work_order_to_receipt_duration', true);
    const received = new Counter('received_work_orders');
    const pending = new Gauge('pending_work_orders');
    const unreceived = new Counter('unreceived_work_orders');

    function setup() {
        for (const key of ['BASE_URL', 'LUMINAR_FACTORY_ID', 'LUMINAR_ORGANIZATION_ID', 'LUMINAR_BUYER_ID',
            'LUMINAR_GARMENT_SIZE_TEMPLATE_ID', 'LUMINAR_PAYMENT_PROVIDER_ID', 'ROLE_RUN_ID', 'ROLE_COORDINATOR_URL', 'ROLE_COORDINATOR_KEY']) requiredEnvValue(key);
        const accounts = selectRoleAccounts(__ENV, users, config);
        const sessions = {};
        for (const [role, entries] of Object.entries(accounts)) {
            sessions[role] = entries.map(account => {
                const session = authenticateAccount(account);
                if (!session) throw new Error(`Setup authentication failed: ${account.label}`);
                return { ...session, authenticatedAt: Date.now() };
            });
        }
        coordinationErrors.add(0); integrityErrors.add(0); quantityErrors.add(0); duplicateReceipts.add(0); duplicateAttempts.add(0);
        return { accounts, sessions, config, runId: __ENV.ROLE_RUN_ID, startedAt: Date.now() };
    }

    function teardown() {
        const ledger = coordinate('/summary');
        for (const workflow of ledger.workflows) {
            e2e.add(workflow.state === 'received');
            const order = ledger.orders.find(value => value.workflowId === workflow.id && value.state === 'received');
            if (order) {
                duration.add(order.receivedAt - workflow.startedAt);
                handoff.add(order.receivedAt - order.createdAt);
            }
        }
        received.add(ledger.stats.received);
        pending.add(ledger.stats.pending);
        unreceived.add(ledger.stats.pending);
    }
    return { options, setup, teardown };
}
