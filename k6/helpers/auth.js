import http from 'k6/http';
import { check } from 'k6';

const users = JSON.parse(open('../data/users.json'));

function getEnvValue(name, fallback = '') {
    return String(__ENV[name] ?? fallback).trim();
}

function parseSessionTokenFromSetCookie(setCookieHeader) {
    if (!setCookieHeader) return null;

    const headerValue = Array.isArray(setCookieHeader)
        ? setCookieHeader.join('; ')
        : String(setCookieHeader);

    const match = headerValue.match(/better-auth\.session_token=([^;]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
}

export function getUserCredentials(role) {
    const config = users[role];

    if (!config) {
        throw new Error(`Unknown role: ${role}`);
    }

    return {
        email: getEnvValue(config.emailEnvKey),
        password: getEnvValue(config.passwordEnvKey),
        role: config.role,
    };
}

export function setupAuth() {
    const auth = login('merchandiser');

    if (!auth) {
        throw new Error('Setup login failed');
    }

    return { token: auth.token, userId: auth.userId };
}

export function login(role = 'merchandiser') {
    const credentials = getUserCredentials(role);
    const baseUrl = getEnvValue('BASE_URL', 'http://localhost:5000');

    const resp = http.post(
        `${baseUrl}/api/v1/auth/sign-in/email`,
        JSON.stringify({
            email: credentials.email,
            password: credentials.password,
        }),
        {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/plain, */*',
                Origin: baseUrl,
            },
            tags: { feature: 'login', endpoint: 'sign-in-email', name: 'login_sign_in_email' },
        },
    );

    const ok = check(resp, {
        'login status is 200 or 201': (r) => r.status === 200 || r.status === 201,
        'login returns token': (r) => {
            try {
                const body = r.json();
                return !!(
                    body?.token ||
                    body?.data?.token ||
                    body?.accessToken ||
                    body?.data?.accessToken ||
                    body?.session?.token ||
                    parseSessionTokenFromSetCookie(r.headers?.['Set-Cookie'])
                );
            } catch (err) {
                return !!parseSessionTokenFromSetCookie(r.headers?.['Set-Cookie']);
            }
        },
    });

    if (!ok) {
        console.error(`Login failed for ${role}: ${resp.status} ${resp.body}`);
        return null;
    }

    const body = resp.json();
    const tokenFromBody = body?.token || body?.data?.token || body?.accessToken || body?.data?.accessToken || body?.session?.token || null;
    const tokenFromCookie = parseSessionTokenFromSetCookie(resp.headers?.['Set-Cookie']);
    const finalToken = tokenFromBody || tokenFromCookie;

    __ENV.SAVED_SESSION_TOKEN = finalToken || '';
    __ENV.SAVED_USER_ID = body?.user?.id || body?.data?.user?.id || body?.userId || body?.data?.userId || '';

    return {
        token: finalToken,
        userId: body?.user?.id || body?.data?.user?.id || body?.userId || body?.data?.userId || null,
    };
}
