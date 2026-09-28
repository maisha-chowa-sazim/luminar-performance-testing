import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/env.js';
import { authHeaders } from '../helpers/http.js';

export function oauthAccessTokensIndex(token) {
    const baseTags = { feature: 'oauth_access_tokens' };

    const resp = http.get(
        `${BASE_URL}/api/v1/oauth_access_tokens`,
        {
            headers: authHeaders(token),
            tags: { ...baseTags, endpoint: 'index', name: 'oauth_access_tokens_index' },
        },
    );

    check(resp, {
        'oauth_access_tokens index status is 200': (r) => r.status === 200,
    });
}
