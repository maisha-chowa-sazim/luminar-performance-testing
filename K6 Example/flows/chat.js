import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/env.js';
import { authHeaders, jsonHeaders } from '../helpers/http.js';
import { CHAT_MESSAGE_PAYLOAD, TEST_DATA } from '../data/test-data.js';

export function chat(token, userId) {
    const baseTags = { feature: 'chat' };

    const listResp = http.get(
        `${BASE_URL}/api/v1/chat_rooms`,
        { headers: authHeaders(token), tags: { ...baseTags, endpoint: 'index', name: 'chat_rooms_index' } },
    );
    check(listResp, {
        'chat_rooms status is 200': (r) => r.status === 200,
    });

    const directResp = http.post(
        `${BASE_URL}/api/v1/chat_rooms/get_direct_chat_room`,
        JSON.stringify({
            user_ids: [TEST_DATA.directChatUserId],
            chat_room_id: TEST_DATA.chatRoomId,
        }),
        { headers: jsonHeaders(token), tags: { ...baseTags, endpoint: 'get_direct_chat_room', name: 'chat_rooms_get_direct_chat_room' } },
    );
    check(directResp, {
        'get_direct_chat_room status is 200': (r) => r.status === 200,
    });

    const showResp = http.get(
        `${BASE_URL}/api/v1/chat_rooms/${TEST_DATA.chatRoomId}`,
        { headers: authHeaders(token), tags: { ...baseTags, endpoint: 'show', name: 'chat_rooms_show' } },
    );
    check(showResp, {
        'chat_rooms show status is 200': (r) => r.status === 200,
    });

    const messagesResp = http.get(
        `${BASE_URL}/api/v1/chat_rooms/${TEST_DATA.chatRoomId}/chat_messages`,
        { headers: authHeaders(token), tags: { ...baseTags, endpoint: 'messages_index', name: 'chat_messages_index' } },
    );
    check(messagesResp, {
        'chat_messages index status is 200': (r) => r.status === 200,
    });

    const createResp = http.post(
        `${BASE_URL}/api/v1/chat_rooms/${TEST_DATA.chatRoomId}/chat_messages`,
        JSON.stringify(CHAT_MESSAGE_PAYLOAD),
        { headers: jsonHeaders(token), tags: { ...baseTags, endpoint: 'messages_create', name: 'chat_messages_create' } },
    );
    check(createResp, {
        'chat_messages create status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });

    const pinnedResp = http.get(
        `${BASE_URL}/api/v1/chat_rooms/${TEST_DATA.chatRoomId}/chat_messages/pinned`,
        { headers: authHeaders(token), tags: { ...baseTags, endpoint: 'messages_pinned', name: 'chat_messages_pinned' } },
    );
    check(pinnedResp, {
        'chat_messages pinned status is 200': (r) => r.status === 200,
    });

    const unreadResp = http.get(
        `${BASE_URL}/api/v1/chat_rooms/get_unread_counts?user_id=${userId}&chat_room_type=clinical`,
        { headers: authHeaders(token), tags: { ...baseTags, endpoint: 'unread_counts', name: 'chat_rooms_get_unread_counts' } },
    );
    check(unreadResp, {
        'get_unread_counts status is 200': (r) => r.status === 200,
    });
}
