function getEnvValue(name, fallback = '') {
    return String(__ENV[name] ?? fallback).trim();
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
        'x-factory-id': getEnvValue('LUMINAR_FACTORY_ID', '2f7e5d9a-3c1b-4e8f-9a6d-1b2c3d4e5f60'),
        'x-organization-id': getEnvValue('LUMINAR_ORGANIZATION_ID', '0e3c4b48-c231-4252-9be7-aafb4a647d05'),
    };
}

export function getApiUrl(path) {
    return `${getEnvValue('BASE_URL', 'http://localhost:5000')}${path}`;
}
