import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { writeReports } from './report.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
// Node's parser handles quoted dotenv values without executing shell code.
if (existsSync('.env')) process.loadEnvFile('.env');
const args = process.argv.slice(2);
const dashboardMode = args[0] === '--dashboard';
const input = (dashboardMode ? args[1] : args[0]) || 'smoke';
if (!/^[a-z0-9-]+(?:\.js)?$/.test(input) || args.length > (dashboardMode ? 2 : 1)) {
    throw new Error('Usage: node k6/reporting/run.mjs [--dashboard] [scenario-name]');
}
const scenario = input.replace(/\.js$/, '');
if (!existsSync(`k6/scenarios/${scenario}.js`)) throw new Error(`Unknown scenario: ${scenario}`);
const dashboardEnabled = dashboardMode || process.env.K6_WEB_DASHBOARD === 'true';
const directory = path.join(root, 'k6/results', `${new Date().toISOString().replace(/[:.]/g, '-')}-${scenario}-${randomUUID().slice(0,8)}`);
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(path.join(root, 'k6/scenarios/.report-'));
const summaryPath = path.join(directory, 'summary.json');
const wrapper = path.join(temporary, 'entry.js');
await writeFile(wrapper, `import * as scenarioModule from '../${scenario}.js';\nexport * from '../${scenario}.js';\nexport { default } from '../${scenario}.js';\nexport function handleSummary(data) { return { [${JSON.stringify(summaryPath)}]: JSON.stringify({ ...data, configuredOptions: scenarioModule.options }, null, 2) }; }\n`);
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim() || 'unknown';
let environment = 'unspecified';
try { environment = new URL(process.env.BASE_URL).origin; } catch { /* Do not embed credentials or malformed URLs. */ }
const metadata = {
    scenario, environment, startedAt: new Date().toISOString(),
    revision: `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? ' (dirty working tree)' : ''}`,
    k6Version: spawnSync('k6', ['version'], { encoding: 'utf8' }).stdout?.trim() || 'unavailable',
};
const start = Date.now();
let interrupted = false;
try {
    const childEnvironment = { ...process.env, K6_SUMMARY_MODE: 'full' };
    if (dashboardEnabled) {
        childEnvironment.K6_WEB_DASHBOARD = 'true';
        childEnvironment.K6_WEB_DASHBOARD_OPEN ??= 'true';
        childEnvironment.K6_WEB_DASHBOARD_EXPORT ||= path.join(directory, 'k6-dashboard.html');
        const host = childEnvironment.K6_WEB_DASHBOARD_HOST || 'localhost';
        const port = childEnvironment.K6_WEB_DASHBOARD_PORT || '5665';
        console.log(`k6 web dashboard: http://${host}:${port}`);
        console.log(`Dashboard HTML export: ${childEnvironment.K6_WEB_DASHBOARD_EXPORT}`);
    }
    const child = spawn('k6', ['run', '--no-usage-report', '--new-machine-readable-summary=false', '--summary-trend-stats=avg,min,med,max,p(90),p(95),p(99)', wrapper], {
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
    if (ramp?.stages) metadata.profile = `ramping-vus from ${ramp.startVUs} VUs: ${ramp.stages.map(s => `${s.duration} to ${s.target} VUs`).join(' / ')}; graceful ramp-down ${ramp.gracefulRampDown}, stop ${ramp.gracefulStop}; think time ${process.env.THINK_TIME_SECONDS || 3}s`;
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
    const status = await writeReports(directory, summary, metadata);
    console.log(`\n${status}: ${directory}/report.pdf\nHTML, summary JSON (when available), and metadata are in the same directory.`);
    if (dashboardEnabled) console.log(`k6 dashboard report: ${childEnvironment.K6_WEB_DASHBOARD_EXPORT}`);
    process.exitCode = metadata.exitCode || (status === 'PASS' || status === 'UNASSESSED' ? 0 : 1);
} finally {
    await rm(temporary, { recursive: true, force: true });
}
