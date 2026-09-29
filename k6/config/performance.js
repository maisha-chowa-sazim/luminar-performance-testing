// Durations include ramp-up + steady state + ramp-down; grace can extend wall time.
export const PROFILES = {
    5: { purpose: 'Baseline / light load', stages: ['1m', '3m', '1m'] },
    10: { purpose: 'Target / expected usage', stages: ['2m', '14m', '2m'] },
    20: { purpose: '2x target / scalability', stages: ['2m', '6m', '2m'] },
    50: { purpose: 'High load / stress', stages: ['2m', '4m', '2m'] },
    100: { purpose: 'Stress / breaking-point observation', stages: ['1m', '3m', '1m'] },
};

export function performanceOptions(users) {
    const profile = PROFILES[users];
    if (!profile) throw new Error(`Unsupported load: ${users}`);
    const endpointMetrics = {};
    for (const name of ['login_sign_in_email', 'style_create', 'style_get', 'sample_create', 'tech_pack_upload_urls', 'tech_pack_file_upload', 'tech_pack_create', 'bom_create', 'pre_costing_create', 'pre_costing_submit', 'purchase_order_create', 'work_order_reserve_number', 'work_order_create', 'work_order_sent_to_supplier', 'grn_create', 'approval_purchase_order', 'approval_bom', 'approval_costing', 'approval_work_order']) {
        for (const metric of ['http_req_duration', 'http_req_failed', 'http_reqs']) {
            endpointMetrics[`${metric}{name:${name}}`] = [];
        }
    }
    return {
        scenarios: {
            full_journey: {
                executor: 'ramping-vus', startVUs: 0,
                stages: profile.stages.map((duration, index) => ({ duration, target: index === 2 ? 0 : users })),
                gracefulRampDown: '2m', gracefulStop: '2m',
            },
        },
        summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
        // Exclude dynamic URLs (including signed upload URLs) from metric tags.
        systemTags: ['status', 'method', 'name', 'group', 'check', 'error_code', 'scenario', 'expected_response'],
        thresholds: {
            ...endpointMetrics,
            // Provisional acceptance targets: agree these with product owners.
            http_req_failed: ['rate<0.01'],
            http_req_duration: ['p(95)<3000', 'p(99)<5000'],
            checks: ['rate>0.99'],
            journey_success: ['rate>0.99'],
            journey_started: ['count>0'],
            journey_completed: ['count>0'],
        },
    };
}
