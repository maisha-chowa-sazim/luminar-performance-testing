// Pure configuration: shared by the Node runner, k6, and offline tests.
export const ROLE_ALLOCATIONS = { 2: [1, 1], 5: [4, 1], 10: [8, 2], 20: [16, 4], 50: [40, 10] };

export function seconds(value) {
    if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value)) throw new Error(`Invalid duration: ${value}`);
    return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)]
        .reduce((sum, [, n, unit]) => sum + Number(n) * ({ ms: 0.001, s: 1, m: 60, h: 3600 }[unit]), 0);
}

export function roleConfig(env) {
    const number = (key, fallback, min, max = Infinity) => {
        const n = Number(env[key] ?? fallback);
        if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${key}`);
        return n;
    };
    const total = number('ROLE_TOTAL_VUS', 10, 2, 50);
    const allocation = ROLE_ALLOCATIONS[total];
    const merchandiser = number('ROLE_MERCHANDISER_VUS', allocation?.[0], 1, 49);
    const inventory = number('ROLE_INVENTORY_VUS', allocation?.[1], 1, 49);
    if (![total, merchandiser, inventory].every(Number.isInteger) || merchandiser + inventory !== total) {
        throw new Error('Role VUs must be integers summing to ROLE_TOTAL_VUS (maximum 50)');
    }
    const duration = (key, fallback, allowZero = false) => {
        const value = env[key] || fallback;
        if (seconds(value) < (allowZero ? 0 : 0.001)) throw new Error(`Invalid ${key}`);
        return value;
    };
    const config = {
        total, merchandiser, inventory,
        rampUp: duration('ROLE_RAMP_UP', total === 2 ? '1s' : '2m'),
        steady: duration('ROLE_STEADY', total === 2 ? '10m' : '15m'),
        rampDown: duration('ROLE_RAMP_DOWN', total === 2 ? '1s' : '2m'),
        grace: duration('ROLE_GRACE', '10m', true),
        drain: duration('ROLE_DRAIN', '5m', true),
        apiP95: number('ROLE_API_P95_MS', 2000, 1),
        apiP99: number('ROLE_API_P99_MS', 5000, 1),
        httpFailure: number('ROLE_HTTP_FAILURE_RATE', 0.01, 0, 1),
        completion: number('ROLE_COMPLETION_RATE', 0.99, 0, 1),
        thinkScale: number('ROLE_THINK_SCALE', 1, 0),
        pollInterval: number('ROLE_POLL_INTERVAL_SECONDS', 2, 0.1),
        pollTimeout: number('ROLE_POLL_TIMEOUT_SECONDS', 60, 0.1),
        sessionMaxAge: number('ROLE_SESSION_MAX_AGE_SECONDS', 900, 1),
        maxWorkflowsPerVU: number('ROLE_MAX_WORKFLOWS_PER_VU', 0, 0),
    };
    if (!Number.isInteger(config.maxWorkflowsPerVU)) throw new Error('ROLE_MAX_WORKFLOWS_PER_VU must be an integer');
    config.producerSeconds = seconds(config.rampUp) + seconds(config.steady) + seconds(config.rampDown);
    return config;
}

export const OPERATIONS = ['login_sign_in_email', 'style_create', 'style_get', 'sample_create',
    'tech_pack_upload_urls', 'tech_pack_file_upload', 'tech_pack_create', 'bom_create',
    'pre_costing_create', 'pre_costing_submit', 'purchase_order_create', 'work_order_reserve_number',
    'work_order_create', 'approval_bom', 'approval_costing', 'approval_purchase_order',
    'approval_work_order', 'work_order_sent_to_supplier', 'work_order_find', 'work_order_get',
    'grn_create', 'grn_get', 'grn_list', 'grn_item_inspect', 'inventory_entry_create', 'inventory_entry_get'];

export function roleOptions(config) {
    const stages = users => [
        { duration: config.rampUp, target: users }, { duration: config.steady, target: users },
        { duration: config.rampDown, target: 0 },
    ];
    return {
        setupTimeout: '30m', teardownTimeout: '2m',
        summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
        systemTags: ['status', 'method', 'name', 'group', 'check', 'error_code', 'scenario', 'expected_response'],
        scenarios: {
            merchandiser: { executor: 'ramping-vus', exec: 'merchandiser', startVUs: 0,
                stages: stages(config.merchandiser), gracefulRampDown: config.grace, gracefulStop: config.grace,
                tags: { traffic: 'application', role: 'merchandiser' } },
            inventory: { executor: 'ramping-vus', exec: 'inventory', startVUs: 0,
                stages: [
                    { duration: config.rampUp, target: config.inventory },
                    { duration: config.steady, target: config.inventory },
                    // Keep consumers alive through producer ramp-down, grace, and drain.
                    { duration: `${seconds(config.rampDown) + seconds(config.grace) + seconds(config.drain)}s`, target: config.inventory },
                    { duration: config.rampDown, target: 0 },
                ], gracefulRampDown: config.grace, gracefulStop: config.grace,
                tags: { traffic: 'application', role: 'inventory' } },
        },
        thresholds: {
            ...Object.fromEntries(OPERATIONS.flatMap(name => ['http_req_duration', 'http_req_failed', 'http_reqs']
                .map(metric => [`${metric}{name:${name}}`, []]))),
            'http_req_duration{traffic:application}': [`p(95)<${config.apiP95}`, `p(99)<${config.apiP99}`],
            'http_req_failed{traffic:application}': [`rate<${config.httpFailure}`],
            e2e_success: [`rate>=${config.completion}`],
            merchandiser_attempted: ['count>0'], received_work_orders: ['count>0'],
            incorrect_inventory_quantities: ['count==0'], duplicate_successful_receipts: ['count==0'],
            data_integrity_violations: ['count==0'], coordination_errors: ['count==0'],
        },
    };
}
