import http from 'k6/http';
import { check, sleep } from 'k6';

const users = JSON.parse(open('../data/users.json'));
export const accounts = Object.entries(users).flatMap(([role, config]) =>
    (config.accounts || [config]).map((account, index) => ({
        ...account, role, label: config.accounts ? `${role}_U${index + 1}` : role,
    })));

function numberSetting(name, minimum = 0) {
    const rawValue = __ENV[name];
    if (rawValue === undefined || rawValue.trim() === '') throw new Error(`${name} is required`);
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid ${name}`);
    return value;
}
const delay = numberSetting('LOGIN_DELAY_SECONDS', 0.1);
const retries = numberSetting('LOGIN_MAX_RETRIES');
if (!Number.isInteger(retries)) throw new Error('LOGIN_MAX_RETRIES must be an integer');
const maxWait = numberSetting('LOGIN_MAX_RETRY_WAIT_SECONDS', 0.1);

export function validateAccounts() {
    if (typeof __ENV.BASE_URL !== 'string' || !__ENV.BASE_URL.trim()) throw new Error('BASE_URL is required');
    if (accounts.length !== 42 || users.merchandiser.accounts.length !== 20 || users.inventory.accounts.length !== 20) {
        throw new Error('Expected 20 merchandisers, 20 inventory users, executive and senior merchandiser');
    }
    const missing = accounts.flatMap((account) => [account.emailEnvKey, account.passwordEnvKey])
        .filter((key) => typeof __ENV[key] !== 'string' || !__ENV[key].trim());
    if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

export function retryAfterSeconds(value, now = Date.now()) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text);
    const date = Date.parse(text);
    return Number.isFinite(date) ? Math.max(0, (date - now) / 1000) : null;
}

export function authenticateAccount(account) {
    const baseUrl = __ENV.BASE_URL.trim().replace(/\/$/, '');
    let response;
    for (let attempt = 0; attempt <= retries; attempt++) {
        // Isolate identities when several accounts log in within the same setup VU.
        http.cookieJar().clear(baseUrl);
        response = http.post(`${baseUrl}/api/v1/auth/sign-in/email`, JSON.stringify({
            email: __ENV[account.emailEnvKey].trim(),
            password: __ENV[account.passwordEnvKey].trim(),
        }), {
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: baseUrl },
            tags: { feature: 'login', name: 'login_sign_in_email', account: account.label },
            timeout: '30s',
        });
        if (response.status !== 429 || attempt === retries) break;
        const header = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'retry-after')?.[1];
        const wait = Math.max(delay, retryAfterSeconds(header) ?? delay * (2 ** attempt));
        // Never retry sooner than Retry-After when it exceeds our allowed wait.
        if (wait > maxWait) break;
        console.warn(`${account.label}: HTTP 429; retrying in ${wait}s`);
        sleep(wait);
    }
    let body = null;
    try { body = response.json(); } catch { /* Cookie-only sessions are supported. */ }
    const header = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'set-cookie')?.[1] || '';
    const cookies = Array.isArray(header) ? header.join('; ') : String(header);
    const cookieToken = /better-auth\.session_token=([^;]+)/i.exec(cookies)?.[1];
    const token = body?.token || body?.data?.token || body?.accessToken || body?.data?.accessToken
        || body?.session?.token || (cookieToken ? decodeURIComponent(cookieToken) : null);
    const passed = check(response, {
        [`${account.label}: authenticated`]: (r) => (r.status === 200 || r.status === 201) && Boolean(token),
    });
    console.log(`${account.label}: ${passed ? 'PASS' : 'FAIL'} (HTTP ${response.status})`);
    sleep(delay);
    return passed ? { token, label: account.label } : null;
}

export function setupSessions() {
    validateAccounts();
    const sessions = {};
    for (const account of accounts) {
        const session = authenticateAccount(account);
        if (!session) throw new Error(`Authentication failed for ${account.label}; business load cancelled`);
        (sessions[account.role] ||= []).push(session);
    }
    return { sessions };
}

export function sessionsForVU(data, vuId) {
    if (!data?.sessions) throw new Error('Session setup data is required');
    return Object.fromEntries(Object.entries(data.sessions).map(([role, sessions]) =>
        [role, sessions[(vuId - 1) % sessions.length]]));
}
