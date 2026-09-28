import { sleep } from 'k6';
import { getProfile } from '../config/profiles.js';
import { oauthAccessTokensIndex } from '../flows/oauth-access-tokens.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: getProfile(),
    thresholds: {
        http_req_failed: ['rate<0.01'],
        'http_req_duration{feature:oauth_access_tokens, endpoint:index}': ['p(95)<500'],
    },
};

export default function (data) {
    oauthAccessTokensIndex(data.token);
    sleep(1);
}
