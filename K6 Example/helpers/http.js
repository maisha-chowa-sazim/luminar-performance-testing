export function authHeaders(token) {
    return {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/plain, */*',
    };
}

export function jsonHeaders(token) {
    return {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
    };
}
