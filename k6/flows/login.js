import http from 'k6/http';
import { check } from 'k6';

function getEnvValue(name, fallback = '') {
    return String(__ENV[name] ?? fallback).trim();
}

export function login(email, password) {
    const baseUrl = getEnvValue('BASE_URL', 'http://localhost:5000');

    const resp = http.post(
        `${baseUrl}/api/v1/auth/sign-in/email`,
        JSON.stringify({
            email,
            password,
        }),
        {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/plain, */*',
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
                    body?.session?.token
                );
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Login failed: ${resp.status} ${resp.body}`);
        return null;
    }

    const body = resp.json();
    return {
        token: body?.token || body?.data?.token || body?.accessToken || body?.data?.accessToken || body?.session?.token || null,
        userId: body?.user?.id || body?.data?.user?.id || body?.userId || body?.data?.userId || null,
    };
}
