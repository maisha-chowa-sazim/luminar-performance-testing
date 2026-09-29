import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { reportModel } from '../reporting/report.mjs';

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
test('all profiles load in k6 with expected stages and completion gates', () => {
    const totals = { 5: 300, 10: 1080, 20: 600, 50: 480, 100: 300 };
    for (const [users, seconds] of Object.entries(totals)) {
        const result = spawnSync('k6', ['inspect', `k6/scenarios/load-${users}-users.js`], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const options = JSON.parse(result.stdout);
        const scenario = options.scenarios.full_journey;
        assert.equal(scenario.executor, 'ramping-vus');
        assert.equal(scenario.startVUs, 0);
        assert.deepEqual(scenario.stages.map(s => s.target), [+users, +users, 0]);
        assert.equal(scenario.stages.reduce((sum, s) => sum + Number(s.duration.match(/\d+/)[0]) * 60, 0), seconds);
        assert.deepEqual(options.thresholds.journey_success, ['rate>0.99']);
    }
});
test('real k6 report pipeline produces PDF/HTML and preserves failed exit codes without network requests', async () => {
    for (const mode of ['pass', 'fail', 'setup-error']) {
        const name = `report-selftest-${mode}-${process.pid}`;
        const scenario = `k6/scenarios/${name}.js`;
        // Synthetic counter named http_reqs exercises report plumbing only; no API is contacted.
        await writeFile(scenario, `import { Counter } from 'k6/metrics';\nimport { check } from 'k6';\nconst requests = new Counter('http_reqs');\nexport const options = { vus: 1, iterations: 1, thresholds: { checks: ['rate==1'] } };\nexport function setup() { ${mode === 'setup-error' ? "throw new Error('Synthetic setup failure');" : ''} }\nexport default function () { requests.add(1); check(true, { 'SYNTHETIC report plumbing only': () => ${mode === 'pass'} }); }\n`);
        try {
            const run = spawnSync(process.execPath, ['k6/reporting/run.mjs', name], { encoding: 'utf8' });
            assert.equal(run.status, mode === 'pass' ? 0 : mode === 'fail' ? 99 : 107, run.stdout + run.stderr);
            const dirs = (await readdir('k6/results')).filter(d => d.includes(name));
            assert.equal(dirs.length, 1);
            const dir = `k6/results/${dirs[0]}`;
            const pdf = await readFile(`${dir}/report.pdf`);
            assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
            assert.match(pdf.toString(), /%%EOF/);
            const html = await readFile(`${dir}/report.html`, 'utf8');
            assert.match(html, new RegExp(`<strong>${mode === 'pass' ? 'PASS' : mode === 'fail' ? 'FAIL' : 'INCOMPLETE'}</strong>`));
            if (mode !== 'setup-error') assert.match(html, /SYNTHETIC report plumbing only/);
        } finally { await rm(scenario, { force: true }); }
    }
});
