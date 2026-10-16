import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

const browser = process.env.DASHBOARD_TEST_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

test('live dashboard stays visible when setup ends and late business metrics appear', {
    skip: !existsSync(browser) && 'Set DASHBOARD_TEST_BROWSER to a Chrome/Chromium binary for the browser regression', timeout: 60000,
}, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'luminar-dashboard-browser-'));
    const dashboardPort = await freePort(), debugPort = await freePort();
    const api = createServer((_req, res) => res.end('{}'));
    await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
    const name = `load-dashboard-selftest-${process.pid}`;
    const scenario = `k6/scenarios/${name}.js`;
    await writeFile(scenario, `import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter } from 'k6/metrics';
const created = new Counter('created_work_orders'), completed = new Counter('inventory_completed');
export const options = { scenarios: {
  merchandiser: {executor:'constant-vus',exec:'merchandiser',vus:1,duration:'16s'},
  inventory: {executor:'constant-vus',exec:'inventory',vus:1,duration:'16s'}
}, thresholds: {checks:['rate==1']} };
export default function() {}
function request(){ const r=http.get('http://127.0.0.1:${api.address().port}/');check(r,{'synthetic local HTTP succeeds':r=>r.status===200}); }
export function setup(){ for(let i=0;i<4;i++){request();sleep(1);} }
let count=0;
export function merchandiser(){ request();if(count++===1)created.add(1);sleep(1); }
export function inventory(){ request();if(count++===7)completed.add(1);sleep(1); }
`);
    const env = { ...process.env, K6_WEB_DASHBOARD: 'true', K6_WEB_DASHBOARD_OPEN: 'false',
        K6_WEB_DASHBOARD_HOST: '127.0.0.1', K6_WEB_DASHBOARD_PORT: `${dashboardPort}`, K6_WEB_DASHBOARD_PERIOD: '1s' };
    delete env.XK6_DASHBOARD_CONFIG; delete env.K6_WEB_DASHBOARD_EXPORT;
    const runner = spawn(process.execPath, ['k6/reporting/run.mjs', name], { env });
    let output = '';
    runner.stdout.on('data', value => output += value); runner.stderr.on('data', value => output += value);
    const finished = new Promise(resolve => runner.on('close', code => resolve(code)));
    const chrome = spawn(browser, ['--headless=new', `--user-data-dir=${directory}/chrome`, `--remote-debugging-port=${debugPort}`,
        '--remote-debugging-address=127.0.0.1', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', 'about:blank'],
    { stdio: 'ignore' });
    const browserFinished = new Promise(resolve => chrome.on('close', resolve));
    let socket;
    try {
        let tab;
        for (let i=0; i<100; i++) {
            try { tab = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page' && t.url === 'about:blank'); } catch {}
            if (tab) break;
            await pause(100);
        }
        assert.ok(tab, 'Isolated Chrome page must be available');
        socket = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
        let next = 0;
        const pending = new Map(), errors = [];
        socket.addEventListener('message', ({ data }) => {
            const message = JSON.parse(data);
            if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
            if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        });
        const call = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++next;
            const timer = setTimeout(() => reject(new Error(`Browser command timed out: ${method}`)), 5000);
            pending.set(id, response => { clearTimeout(timer); resolve(response); });
            socket.send(JSON.stringify({ id, method, params }));
        });
        await call('Runtime.enable'); await call('Page.enable');
        for (let i=0; i<100; i++) {
            try { if ((await fetch(`http://127.0.0.1:${dashboardPort}/ui/`)).ok) break; } catch {}
            await pause(100);
        }
        await call('Page.navigate', { url: `http://127.0.0.1:${dashboardPort}/ui/?endpoint=/` });
        let text;
        for (let i=0; i<6; i++) {
            await pause(3000);
            const response = await call('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
            text = response.result?.result?.value || '';
            assert.match(text, /HTTP Request Rate/, `Dashboard became blank at sample ${i}: ${errors.join('\n')}`);
            assert.equal(errors.length, 0, errors.join('\n'));
        }
        assert.match(text, /Active VUs/);
        assert.match(text, /Inventory Workflows Completed/);
        const canvas = await call('Runtime.evaluate', { expression: 'document.querySelectorAll("canvas").length', returnByValue: true });
        assert.ok(canvas.result.result.value > 0, 'Real HTTP time-series charts remain available');
        await call('Page.navigate', { url: 'about:blank' });
        socket.close(); socket = null;
        chrome.kill(); await browserFinished;
        assert.equal(await finished, 0, output);
        const run = (await readdir('k6/results')).find(value => value.includes(name));
        assert.ok(run);
        assert.match(await readFile(`k6/results/${run}/k6-dashboard.html`, 'utf8'), /k6/i);
    } finally {
        socket?.close(); chrome.kill(); runner.kill(); api.closeAllConnections();
        await new Promise(resolve => api.close(resolve));
        await browserFinished;
        await rm(scenario, { force: true }); await rm(directory, { recursive: true, force: true });
    }
});
