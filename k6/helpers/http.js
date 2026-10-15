export function requiredEnvValue(name) {
    const value = __ENV[name];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name} is required`);
    }
    return value.trim();
}

export function baseHeaders(token = null) {
    return {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export function tenantHeaders(token = null) {
    return {
        ...baseHeaders(token),
        'x-factory-id': requiredEnvValue('LUMINAR_FACTORY_ID'),
        'x-organization-id': requiredEnvValue('LUMINAR_ORGANIZATION_ID'),
    };
}

export function getApiUrl(path) {
    return `${requiredEnvValue('BASE_URL')}${path}`;
}
