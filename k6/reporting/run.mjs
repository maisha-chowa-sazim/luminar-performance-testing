import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeReports } from './report.mjs';
import { startRoleCoordinator } from './role-coordinator.mjs';
import { roleConfig, configuredThinkRanges, isRoleScenario, roleScenarioEnvironment } from '../config/role-load.mjs';
import { selectRoleAccounts } from '../helpers/role-accounts.mjs';
import { shipmentDate } from '../helpers/shipment-date.mjs';
import { testEnvironment, purchaseFixturePath } from '../config/environment.mjs';
import { runTestType, testTypeSlug } from './test-type.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
// Node's parser handles quoted dotenv values without executing shell code.
const selectedEnvironment = testEnvironment(process.env);
const envFile = selectedEnvironment ? `.env.${selectedEnvironment}` : '.env';
if (selectedEnvironment && !existsSync(envFile)) throw new Error(`Missing environment file: ${envFile}`);
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (testEnvironment(process.env) !== selectedEnvironment) throw new Error('Set TEST_ENV in the command, not inside an environment file');
const args = process.argv.slice(2);
const dashboardMode = args.includes('--dashboard');
const scenarioArgs = args.filter(arg => arg !== '--dashboard');
const input = scenarioArgs[0] || 'smoke';
if (!/^(?:test-scenarios\/)?[a-z0-9-]+(?:\.js)?$/.test(input) || scenarioArgs.length > 1 || args.length > (dashboardMode ? 2 : 1)) {
    throw new Error('Usage: node k6/reporting/run.mjs [--dashboard] [scenario-name]');
}
let scenario = input.replace(/\.js$/, '');
if (!existsSync(`k6/scenarios/${scenario}.js`) && !scenario.includes('/') && existsSync(`k6/scenarios/test-scenarios/${scenario}.js`)) {
    scenario = `test-scenarios/${scenario}`;
}
if (!existsSync(`k6/scenarios/${scenario}.js`)) throw new Error(`Unknown scenario: ${scenario}`);
let roleConfiguration;
const runEnvironment = roleScenarioEnvironment(process.env, scenario);
if (isRoleScenario(scenario)) {
    roleConfiguration = roleConfig(runEnvironment);
    const users = JSON.parse(await readFile(path.join(root, 'k6/data/users.json'), 'utf8'));
    selectRoleAccounts(process.env, users, roleConfiguration);
    for (const key of ['BASE_URL', 'LUMINAR_FACTORY_ID', 'LUMINAR_ORGANIZATION_ID', 'LUMINAR_BUYER_ID', 'LUMINAR_GARMENT_SIZE_TEMPLATE_ID', 'LUMINAR_PAYMENT_PROVIDER_ID']) {
        if (!process.env[key]?.trim()) throw new Error(`${key} is required for independent role testing`);
    }
    const purchase = JSON.parse(await readFile(path.resolve(root, 'k6/flows', purchaseFixturePath(process.env)), 'utf8'));
    for (const shipment of purchase.shipments) shipmentDate(shipment.shipmentDate);
    if (['K6_VUS', 'K6_STAGES', 'K6_DURATION', 'K6_ITERATIONS', 'K6_SCENARIOS', 'K6_EXECUTION_SEGMENT', 'K6_EXECUTION_SEGMENT_SEQUENCE'].some(key => process.env[key])) {
        throw new Error('Use ROLE_* workload settings; K6 workload overrides/segmentation are unsupported for the 100-VU role cap');
    }
    if (process.env.ROLE_RUN_ID && !/^[a-zA-Z0-9-]{1,40}$/.test(process.env.ROLE_RUN_ID)) throw new Error('ROLE_RUN_ID must contain 1–40 letters, digits, or hyphens');
}
// Load runs visualize results by default; explicit environment settings take precedence.
const dashboardEnabled = dashboardMode || (process.env.K6_WEB_DASHBOARD === undefined
    ? scenario.startsWith('load-')
    : process.env.K6_WEB_DASHBOARD === 'true');
const executedTestType = runTestType(scenario, process.env, roleConfiguration);
const directory = path.join(root, 'k6/results', `${testTypeSlug(executedTestType)}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(path.join(root, 'k6/scenarios/.report-'));
const summaryPath = path.join(directory, 'summary.json');
const wrapper = path.join(temporary, 'entry.js');
await writeFile(wrapper, `import * as scenarioModule from '../${scenario}.js';\nexport * from '../${scenario}.js';\nexport { default } from '../${scenario}.js';\nexport function handleSummary(data) { return { [${JSON.stringify(summaryPath)}]: JSON.stringify({ ...data, configuredOptions: scenarioModule.options }, null, 2) }; }\n`);
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim() || 'unknown';
let environment = 'unspecified';
try { environment = new URL(process.env.BASE_URL).origin; } catch { /* Do not embed credentials or malformed URLs. */ }
const metadata = {
    scenario, testType: executedTestType, environment, startedAt: new Date().toISOString(),
    revision: `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? ' (dirty working tree)' : ''}`,
    k6Version: spawnSync('k6', ['version'], { encoding: 'utf8' }).stdout?.trim() || 'unavailable',
};
const start = Date.now();
let interrupted = false;
let coordinator;
try {
    const childEnvironment = { ...runEnvironment, K6_SUMMARY_MODE: 'full' };
    if (roleConfiguration) {
        metadata.roleThinkRanges = configuredThinkRanges(process.env);
        const runId = process.env.ROLE_RUN_ID || `lt-${randomUUID().slice(0, 12)}`;
        coordinator = await startRoleCoordinator(directory, runId, roleConfiguration);
        Object.assign(childEnvironment, {
            ROLE_RUN_ID: runId, ROLE_COORDINATOR_URL: coordinator.url, ROLE_COORDINATOR_KEY: coordinator.secret,
            LOGIN_DELAY_SECONDS: process.env.LOGIN_DELAY_SECONDS || '5',
            LOGIN_RETRY_BASE_SECONDS: process.env.LOGIN_RETRY_BASE_SECONDS || '30',
            LOGIN_MAX_RETRIES: process.env.LOGIN_MAX_RETRIES || '2',
            LOGIN_MAX_RETRY_WAIT_SECONDS: process.env.LOGIN_MAX_RETRY_WAIT_SECONDS || '120',
        });
        metadata.roleConfiguration = roleConfiguration;
        metadata.runId = runId;
        console.log(`Independent roles: ${roleConfiguration.merchandiser} Merchandiser + ${roleConfiguration.inventory} Inventory VUs; run ${runId}`);
    }
    if (dashboardEnabled) {
        childEnvironment.K6_WEB_DASHBOARD = 'true';
        // The embedded UI can crash when a chart gains series after setup.
        // Keep HTTP charts and show late-arriving execution/business metrics as stats.
        if (!childEnvironment.XK6_DASHBOARD_CONFIG && !existsSync('.dashboard.json')) {
            childEnvironment.XK6_DASHBOARD_CONFIG = path.join(root, 'k6/config/dashboard.json');
        }
        childEnvironment.K6_WEB_DASHBOARD_OPEN ??= childEnvironment.K6_WEB_DASHBOARD_PORT === '-1' ? 'false' : 'true';
        childEnvironment.K6_WEB_DASHBOARD_EXPORT ||= path.join(directory, 'k6-dashboard.html');
        const host = childEnvironment.K6_WEB_DASHBOARD_HOST || 'localhost';
        const port = childEnvironment.K6_WEB_DASHBOARD_PORT || '5665';
        if (port === '-1') {
            console.log('k6 web dashboard: HTML export only (HTTP server disabled)');
        } else {
            console.log(`k6 web dashboard: http://${host}:${port}`);
            console.log('Close the dashboard tab after the test so k6 can exit and finish HTML reporting.');
        }
        console.log(`Dashboard HTML export: ${childEnvironment.K6_WEB_DASHBOARD_EXPORT}`);
    }
    const child = spawn('k6', ['run', '--include-system-env-vars', '--no-usage-report', '--new-machine-readable-summary=false', '--summary-trend-stats=avg,min,med,max,p(90),p(95),p(99)', wrapper], {
        stdio: 'inherit', env: childEnvironment,
    });
    const interrupt = signal => { interrupted = true; child.kill(signal); };
    const onInt = () => interrupt('SIGINT');
    const onTerm = () => interrupt('SIGTERM');
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
    await new Promise(resolve => {
        child.on('error', error => { metadata.error = error.message; });
        child.on('close', (code, signal) => { metadata.exitCode = code; metadata.signal = signal; resolve(); });
    });
    process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
    metadata.finishedAt = new Date().toISOString();
    metadata.wallSeconds = (Date.now() - start) / 1000;
    if (interrupted && metadata.exitCode === 0) metadata.exitCode = 130;
    let summary = null;
    try { summary = JSON.parse(await readFile(summaryPath, 'utf8')); }
    catch { metadata.error ||= 'No valid summary produced; initialization failure or interrupted execution.'; }
    const ramp = summary?.configuredOptions?.scenarios?.full_journey;
    if (ramp?.stages) {
        const thinkTime = process.env.THINK_TIME_SECONDS;
        metadata.profile = `ramping-vus from ${ramp.startVUs} VUs: ${ramp.stages.map(s => `${s.duration} to ${s.target} VUs`).join(' / ')}; graceful ramp-down ${ramp.gracefulRampDown}, stop ${ramp.gracefulStop}; think time ${thinkTime ? `${thinkTime}s` : 'not configured'}`;
    }
    const arrival = summary?.configuredOptions?.scenarios?.arrival_journey;
    if (arrival) metadata.profile = `${arrival.executor}: ${arrival.rate} journeys per ${arrival.timeUnit}, duration ${arrival.duration}, ${arrival.preAllocatedVUs} preallocated VUs; paced authentication in setup; sessions reused`;
    if (coordinator) {
        const ledger = coordinator.snapshot();
        metadata.roleHandoff = ledger.stats;
        metadata.roleFailures = [...ledger.workflows, ...ledger.orders].filter(value => value.state === 'failed')
            .map(value => ({ id: value.id, step: value.step, kind: value.kind, httpStatus: value.httpStatus, errorCode: value.errorCode }));
        metadata.profile = `Independent roles: ${roleConfiguration.merchandiser} Merchandiser + ${roleConfiguration.inventory} Inventory VUs; ramp ${roleConfiguration.rampUp}, steady ${roleConfiguration.steady}, ramp-down ${roleConfiguration.rampDown}; producer grace ${roleConfiguration.grace}; drain ${roleConfiguration.drain}`;
    }
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
    const status = await writeReports(directory, summary, metadata);
    console.log(`\n${status}: ${directory}/report.html\nSummary JSON (when available), and metadata are in the same directory.`);
    if (dashboardEnabled) {
        if (existsSync(childEnvironment.K6_WEB_DASHBOARD_EXPORT)) console.log(`k6 dashboard report: ${childEnvironment.K6_WEB_DASHBOARD_EXPORT}`);
        else console.log('k6 dashboard HTML was not generated; the run may have ended before enough dashboard data was collected.');
    }
    process.exitCode = metadata.exitCode || (status === 'PASS' || status === 'UNASSESSED' ? 0 : 1);
} finally {
    if (coordinator) await coordinator.close();
    await rm(temporary, { recursive: true, force: true });
}
