import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, USERNAME, PASSWORD } from '../config/env.js';

export function setupAuth() {
    const auth = login();
    if (!auth) {
        throw new Error('Setup login failed');
    }

    return { token: auth.token, userId: auth.userId };
}

export function login() {
    const resp = http.post(
        `${BASE_URL}/api/v1/oauth/token`,
        JSON.stringify({
            username: USERNAME,
            password: PASSWORD,
            grant_type: 'password',
        }),
        {
            headers: { 'content-type': 'application/json' },
            tags: { feature: 'login' },
        },
    );

    const ok = check(resp, {
        'login status is 200': (r) => r.status === 200,
        'login returns access_token': (r) => {
            try { return !!JSON.parse(r.body).access_token; }
            catch { return false; }
        },
    });

    if (!ok) {
        console.error(`Login failed: ${resp.status} ${resp.body}`);
        return null;
    }

    const body = JSON.parse(resp.body);
    return {
        token: body.access_token,
        userId: body.id,
    };
}
