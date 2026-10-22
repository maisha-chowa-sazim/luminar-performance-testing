// Pure configuration: shared by the Node runner, k6, and offline tests.
export const ROLE_ALLOCATIONS = { 2: [1, 1], 5: [4, 1], 10: [8, 2], 20: [16, 4], 50: [40, 10], 100: [80, 20] };
export const ROLE_LOAD_PROFILES = {
    'load-5-users': { total: 5, steady: '10m', purpose: 'Baseline / light load' },
    'load-10-users': { total: 10, steady: '15m', purpose: 'Target load / expected usage' },
    'load-20-users': { total: 20, steady: '20m', purpose: '2x target / scalability' },
    'load-50-users': { total: 50, steady: '15m', purpose: 'High load / stress behavior' },
    'load-100-users': { total: 100, steady: '10m', purpose: 'Stress / breaking-point observation' },
};

export function isRoleScenario(name) {
    return name === 'load-roles' || Object.prototype.hasOwnProperty.call(ROLE_LOAD_PROFILES, name);
}

export function roleScenarioEnvironment(env, name) {
    const profile = ROLE_LOAD_PROFILES[name];
    if (!profile) return env;
    const [merchandiser, inventory] = ROLE_ALLOCATIONS[profile.total];
    // Named files pin their requested load and steady duration, independently of dotenv overrides.
    return { ...env, ROLE_TOTAL_VUS: String(profile.total), ROLE_MERCHANDISER_VUS: String(merchandiser),
        ROLE_INVENTORY_VUS: String(inventory), ROLE_STEADY: profile.steady };
}

export function configuredThinkRanges(env) {
    const ranges = { login: [0.5, 2], style: [0.5, 2], techpack: [30, 45], sample: [0.5, 2],
        bom: [0.5, 2], costing: [0.5, 2], purchase: [0.5, 2], discover: [0.5, 2] };
    return Object.fromEntries(Object.entries(ranges).map(([step, defaults]) => {
        const values = ['MIN', 'MAX'].map((bound, i) => Number(env[`ROLE_THINK_${step.toUpperCase()}_${bound}`] ?? defaults[i]));
        if (!values.every(n => Number.isFinite(n) && n >= 0) || values[0] > values[1]) throw new Error(`Invalid think-time range for ${step}`);
        return [step, values];
    }));
}

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
    const total = number('ROLE_TOTAL_VUS', 10, 2, 100);
    const allocation = ROLE_ALLOCATIONS[total];
    const merchandiser = number('ROLE_MERCHANDISER_VUS', allocation?.[0], 1, 99);
    const inventory = number('ROLE_INVENTORY_VUS', allocation?.[1], 1, 99);
    if (![total, merchandiser, inventory].every(Number.isInteger) || merchandiser + inventory !== total) {
        throw new Error('Role VUs must be integers summing to ROLE_TOTAL_VUS (maximum 100)');
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
        apiP99: number('ROLE_API_P99_MS', 2000, 1),
        techPackP95: number('ROLE_TECHPACK_P95_MS', 30000, 1),
        techPackP99: number('ROLE_TECHPACK_P99_MS', 45000, 1),
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
    'pre_costing_create', 'purchase_order_create', 'purchase_order_get', 'work_order_reserve_number',
    'work_order_create', 'approval_work_order', 'work_order_sent_to_supplier', 'work_order_find', 'work_order_get',
    'grn_create', 'grn_get', 'grn_list'];

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
                tags: { traffic: 'application', workload: 'api', role: 'merchandiser' } },
            inventory: { executor: 'ramping-vus', exec: 'inventory', startVUs: 0,
                stages: [
                    { duration: config.rampUp, target: config.inventory },
                    { duration: config.steady, target: config.inventory },
                    // Keep consumers alive through producer ramp-down, grace, and drain.
                    { duration: `${seconds(config.rampDown) + seconds(config.grace) + seconds(config.drain)}s`, target: config.inventory },
                    { duration: config.rampDown, target: 0 },
                ], gracefulRampDown: config.grace, gracefulStop: config.grace,
                tags: { traffic: 'application', workload: 'api', role: 'inventory' } },
        },
        thresholds: {
            // Collect scoped throughput for reports without adding acceptance gates.
            'http_reqs{traffic:application}': [],
            'http_reqs{traffic:application,workload:api}': [],
            'http_reqs{traffic:application,workload:techpack}': [],
            ...Object.fromEntries([0, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]
                .map(status => [`http_reqs{traffic:application,status:${status}}`, []])),
            'http_req_duration{traffic:application,expected_response:true}': [],
            'http_req_duration{traffic:application,expected_response:false}': [],
            ...Object.fromEntries(OPERATIONS.flatMap(name => ['http_req_duration', 'http_req_failed', 'http_reqs']
                .map(metric => [`${metric}{name:${name}}`, []]))),
            'http_req_duration{traffic:application}': [],
            'http_req_duration{traffic:application,workload:api}': [`p(95)<${config.apiP95}`, `p(99)<${config.apiP99}`],
            'http_req_duration{traffic:application,workload:techpack}': [`p(95)<${config.techPackP95}`, `p(99)<${config.techPackP99}`],
            'http_req_failed{traffic:application}': [`rate<${config.httpFailure}`],
            e2e_success: [`rate>=${config.completion}`],
            merchandiser_attempted: ['count>0'], received_work_orders: ['count>0'],
            incorrect_inventory_quantities: ['count==0'], duplicate_successful_receipts: ['count==0'],
            data_integrity_violations: ['count==0'], coordination_errors: ['count==0'],
        },
    };
}
