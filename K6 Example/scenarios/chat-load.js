import { sleep } from 'k6';
import { getProfile } from '../config/profiles.js';
import { chat } from '../flows/chat.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    stages: getProfile(),
    thresholds: {
        http_req_failed: ['rate<0.01'],

        'http_req_duration{feature:chat, endpoint:index}': ['p(95)<500'],
        'http_req_duration{feature:chat, endpoint:get_direct_chat_room}': ['p(95)<500'],
        'http_req_duration{feature:chat, endpoint:show}': ['p(95)<400'],
        'http_req_duration{feature:chat, endpoint:messages_index}': ['p(95)<450'],
        'http_req_duration{feature:chat, endpoint:messages_create}': ['p(95)<500'],
        'http_req_duration{feature:chat, endpoint:messages_pinned}': ['p(95)<300'],
        'http_req_duration{feature:chat, endpoint:unread_counts}': ['p(95)<400'],
    },
};

export default function (data) {
    chat(data.token, data.userId);
    sleep(1);
}
