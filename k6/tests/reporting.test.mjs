import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { reportModel } from '../reporting/report.mjs';
import { seconds } from '../config/role-load.mjs';

const sample = ok => ({ metrics: {
    http_reqs: { values: { count: 10, rate: 2 } },
    http_req_failed: { values: { rate: ok ? 0 : 0.5 }, thresholds: { 'rate<0.01': { ok } } },
} });
test('assessment never labels missing data or failed execution as passing', () => {
    assert.equal(reportModel(sample(true), { exitCode: 0 }).status, 'PASS');
    assert.equal(reportModel(sample(false), { exitCode: 99 }).status, 'FAIL');
    assert.equal(reportModel(sample(true), { exitCode: 107 }).status, 'FAIL');
    assert.equal(reportModel(null, { exitCode: 0 }).status, 'INCOMPLETE');
    assert.equal(reportModel({ metrics: { http_reqs: { values: { count: 2 } } } }, { exitCode: 0 }).status, 'UNASSESSED');
});
test('role load levels parse with expected allocations, steady phases, and completion gates', () => {
    const totals = { 5: [4, 1], 10: [8, 2], 20: [16, 4], 50: [40, 10], 100: [80, 20] };
    const steadyMinutes = { 5: 10, 10: 15, 20: 20, 50: 15, 100: 10 };
    const env = {
        ...process.env,
        LOGIN_SETUP_TIMEOUT: '30m',
        LOGIN_DELAY_SECONDS: '1',
        LOGIN_MAX_RETRIES: '2',
        LOGIN_MAX_RETRY_WAIT_SECONDS: '120',
        THINK_TIME_SECONDS: '3',
    };
    for (const [users, allocation] of Object.entries(totals)) {
        const result = spawnSync('k6', ['inspect', '--include-system-env-vars', `k6/scenarios/load-${users}-users.js`], {
            encoding: 'utf8',
            // Conflicting dotenv/workload values must not change a named profile's selected load.
            env: { ...env, ROLE_TOTAL_VUS: '2', ROLE_MERCHANDISER_VUS: '1', ROLE_INVENTORY_VUS: '1', ROLE_RAMP_UP: '2m', ROLE_STEADY: '1s', ROLE_RAMP_DOWN: '2m' },
        });
        assert.equal(result.status, 0, result.stderr);
        const options = JSON.parse(result.stdout);
        const scenario = options.scenarios.merchandiser;
        assert.equal(scenario.executor, 'ramping-vus');
        assert.equal(scenario.startVUs, 0);
        assert.deepEqual(scenario.stages.map(s => s.target), [allocation[0], allocation[0], 0]);
        assert.equal(options.scenarios.inventory.stages[1].target, allocation[1]);
        assert.equal(seconds(scenario.stages[1].duration), steadyMinutes[users] * 60);
        assert.deepEqual(options.thresholds['http_reqs{traffic:application,workload:api}'], []);
        assert.deepEqual(options.thresholds.e2e_success, ['rate>=0.99']);
    }
});
test('named 100-user runner fails account preflight before starting k6 when the pool is too small', () => {
    const run = spawnSync(process.execPath, ['k6/reporting/run.mjs', 'load-100-users'], {
        encoding: 'utf8', env: { ...process.env, MERCHANDISER_ACCOUNT_COUNT:'50', INVENTORY_ACCOUNT_COUNT:'12', K6_WEB_DASHBOARD:'false' }, timeout:10000,
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Insufficient or invalid MERCHANDISER_ACCOUNT_COUNT: need 80/);
    assert.doesNotMatch(run.stdout, /Independent roles:|Starting outputs/);
});
test('real k6 report pipeline produces HTML and dashboard exports and preserves failed exit codes without network requests', async () => {
    for (const mode of ['pass', 'dashboard-flag', 'nested', 'fail', 'setup-error']) {
        const passing = mode === 'pass' || mode === 'dashboard-flag' || mode === 'nested';
        const dashboard = passing;
        const name = `${mode === 'nested' ? 'test-scenarios/' : ''}${mode === 'dashboard-flag' ? '' : 'load-'}report-selftest-${mode}-${process.pid}`;
        const scenario = `k6/scenarios/${name}.js`;
        // Synthetic counter named http_reqs exercises report plumbing only; no API is contacted.
        await writeFile(scenario, `import { Counter } from 'k6/metrics';\nimport { check, sleep } from 'k6';\nconst requests = new Counter('http_reqs');\nexport const options = { vus: 1, iterations: 1, thresholds: { checks: ['rate==1'] } };\nexport function setup() { ${mode === 'setup-error' ? "throw new Error('Synthetic setup failure');" : ''} }\nexport default function () { requests.add(1); check(true, { 'SYNTHETIC report plumbing only': () => ${passing} }); ${passing ? 'sleep(4);' : ''} }\n`);
        try {
            const env = { ...process.env, K6_WEB_DASHBOARD_OPEN: 'false', K6_WEB_DASHBOARD_PORT: '-1', K6_WEB_DASHBOARD_PERIOD: '1s' };
            // Exercise automatic load mode, explicit flag, and opting out on load failures.
            delete env.K6_WEB_DASHBOARD;
            delete env.K6_WEB_DASHBOARD_EXPORT;
            if (!dashboard) env.K6_WEB_DASHBOARD = 'false';
            const run = spawnSync(process.execPath, ['k6/reporting/run.mjs', ...(['dashboard-flag','nested'].includes(mode) ? ['--dashboard'] : []), name], {
                encoding: 'utf8',
                env,
                timeout: 30000,
            });
            assert.equal(run.status, passing ? 0 : mode === 'fail' ? 99 : 107, run.stdout + run.stderr);
            const dirs = (await readdir('k6/results')).filter(d => d.includes(name.replaceAll('/', '-')));
            assert.equal(dirs.length, 1);
            const dir = `k6/results/${dirs[0]}`;
            assert.equal((await readdir(dir)).some(name => name.endsWith('.pdf')), false);
            const html = await readFile(`${dir}/report.html`, 'utf8');
            assert.doesNotMatch(html, /report\.pdf|Download PDF/);
            assert.match(html, new RegExp(`<strong>${passing ? 'PASS' : mode === 'fail' ? 'FAIL' : 'INCOMPLETE'}</strong>`));
            if (dashboard) {
                const dashboardHtml = await readFile(`${dir}/k6-dashboard.html`, 'utf8').catch(() => '');
                assert.equal(dashboardHtml, html, run.stdout + run.stderr);
                assert.match(await readFile(`${dir}/k6-dashboard-native.html`, 'utf8'), /k6/i);
            } else {
                assert.equal((await readdir(dir)).includes('k6-dashboard.html'), false);
            }
            if (mode !== 'setup-error') {
                const savedSummary = JSON.parse(await readFile(`${dir}/summary.json`, 'utf8'));
                const check = savedSummary.root_group.checks.find(value => value.name === 'SYNTHETIC report plumbing only');
                assert.ok(check);
                assert.equal(check.passes, passing ? 1 : 0);
                assert.equal(check.fails, passing ? 0 : 1);
            }
        } finally { await rm(scenario, { force: true }); }
    }
});
