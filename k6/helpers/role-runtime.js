import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { authenticateAccount } from './session-pool.js';
import { requiredEnvValue, getApiUrl, tenantHeaders } from './http.js';

export const coordinationErrors = new Counter('coordination_errors');
export const integrityErrors = new Counter('data_integrity_violations');
export const quantityErrors = new Counter('incorrect_inventory_quantities');
export const duplicateReceipts = new Counter('duplicate_successful_receipts');
export const duplicateAttempts = new Counter('duplicate_receiving_attempts');
export const operationDuration = new Trend('business_operation_duration', true);
const sessions = {};
const ranges = { login: [2, 5], style: [15, 45], techpack: [20, 60], sample: [20, 60],
    bom: [30, 90], costing: [20, 60], purchase: [15, 45], discover: [5, 20] };

export function thinkRanges(env) {
    return Object.fromEntries(Object.entries(ranges).map(([step, defaults]) => {
        const values = ['MIN', 'MAX'].map((bound, i) => Number(env[`ROLE_THINK_${step.toUpperCase()}_${bound}`] ?? defaults[i]));
        if (!values.every(n => Number.isFinite(n) && n >= 0) || values[0] > values[1]) throw new Error(`Invalid think-time range for ${step}`);
        return [step, values];
    }));
}

export function think(step, config) {
    const [min, max] = config.think[step];
    if (config.thinkScale > 0) sleep((min + Math.random() * (max - min)) * config.thinkScale);
}

export function coordinate(path, payload = {}) {
    const response = http.post(`${requiredEnvValue('ROLE_COORDINATOR_URL')}${path}`, JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json', 'x-coordinator-key': requiredEnvValue('ROLE_COORDINATOR_KEY') },
        tags: { traffic: 'coordination', name: `handoff_${path.slice(1)}` }, timeout: '10s',
    });
    if (response.status !== 200) {
        coordinationErrors.add(1);
        throw new Error(`Coordinator ${path} failed (HTTP ${response.status})`);
    }
    return response.json();
}

export function sessionFor(data, role, index, config) {
    const key = `${role}:${index}`;
    let session = sessions[key];
    if (!session) session = sessions[key] = { ...data.sessions[role][index], account: data.accounts[role][index] };
    if (!session.token || Date.now() - session.authenticatedAt >= config.sessionMaxAge * 1000) {
        const refreshed = authenticateAccount(session.account);
        if (!refreshed) throw new Error(`Authentication failed for ${session.account.label}`);
        Object.assign(session, refreshed, { authenticatedAt: Date.now() });
        think('login', config);
    }
    return session;
}

export function requireCondition(ok, step, kind = 'contract') {
    check(ok, { [`${step}: validated`]: value => value === true });
    if (!ok) {
        if (kind === 'integrity') integrityErrors.add(1);
        if (kind === 'quantity') { quantityErrors.add(1); integrityErrors.add(1); }
        throw Object.assign(new Error(`${step}: ${kind} validation failed`), { kind, step });
    }
}

export function responseData(response, status, step, session) {
    if ((!response || response.status === 401) && session) session.token = null; // Refresh at next safe boundary; never replay a write.
    let body;
    try { body = response?.json(); } catch { /* Invalid payload fails validation. */ }
    if (response?.status !== status) {
        check(false, { [`${step}: HTTP status validated`]: value => value });
        const httpStatus = response?.status || 0;
        // Keep only this known non-sensitive API code; never retain arbitrary response text.
        const errorCode = body?.error === 'FEATURE_DISABLED' ? 'FEATURE_DISABLED' : undefined;
        const kind = errorCode ? 'feature_disabled' : httpStatus === 0 ? 'transport_or_script' : httpStatus >= 500 ? 'backend' : httpStatus === 429 ? 'throttling' :
            [401, 403].includes(httpStatus) ? 'authentication_or_permission' : httpStatus === 409 ? 'conflict' : 'validation_or_test_data';
        throw Object.assign(new Error(`${step}: HTTP ${httpStatus}${errorCode ? ` (${errorCode})` : ''}`), { kind, httpStatus, errorCode });
    }
    requireCondition(body?.success === true && body.data !== undefined, step);
    return body.data;
}

export function operation(step, fn) {
    const start = Date.now();
    try { return fn(); } finally { operationDuration.add(Date.now() - start, { step }); }
}

// Only GETs are polled/retried. A transport error on a write is never assumed safe to replay.
export function readApplication(path, name, session, config, predicate = () => true, onStateTimeout = null) {
    const until = Date.now() + config.pollTimeout * 1000;
    let lastData;
    while (true) {
        const response = http.get(getApiUrl(path), { headers: tenantHeaders(session.token),
            tags: { name }, timeout: `${Math.min(30, config.pollTimeout)}s` });
        if (response.status === 401) {
            session.token = null;
            throw new Error(`${name}: session expired; no dependent writes sent`);
        }
        if (response.status === 200) {
            const data = responseData(response, 200, name, session);
            lastData = data;
            if (predicate(data)) return data;
        } else if (![0, 404, 429, 500, 502, 503, 504].includes(response.status)) {
            throw new Error(`${name}: HTTP ${response.status}`);
        }
        if (Date.now() >= until) {
            if (lastData && onStateTimeout) onStateTimeout(lastData);
            throw new Error(`${name}: read/state polling timed out`);
        }
        // A long Retry-After ends the attempt rather than retrying too early.
        const retryAfter = response.headers?.['Retry-After'];
        const retrySeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) :
            retryAfter ? Math.max(0, (Date.parse(retryAfter) - Date.now()) / 1000) : 0;
        const wait = Math.max(config.pollInterval, retrySeconds || 0);
        if (Date.now() + wait * 1000 > until) {
            if (lastData && onStateTimeout) onStateTimeout(lastData);
            throw new Error(`${name}: retry wait exceeds polling timeout`);
        }
        sleep(wait);
    }
}

export function writeApplication(method, path, payload, name, session) {
    return http.request(method, getApiUrl(path), JSON.stringify(payload), {
        headers: tenantHeaders(session.token), tags: { name }, timeout: '30s',
    });
}
