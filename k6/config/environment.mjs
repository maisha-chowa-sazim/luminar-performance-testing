export function testEnvironment(env) {
    const name = env.TEST_ENV;
    if (name === undefined) return null;
    if (!['qa', 'prod'].includes(name)) throw new Error('TEST_ENV must be qa or prod');
    return name;
}

export function bomFixturePath(env) {
    return testEnvironment(env) === 'prod' ? '../data/prod/bom.json' : '../data/bom.json';
}

export function purchaseFixturePath(env) {
    return testEnvironment(env) === 'prod' ? '../data/prod/purchase.json' : '../data/purchase.json';
}

export function workOrderFixturePath(env) {
    return testEnvironment(env) === 'prod' ? '../data/prod/work-order.json' : '../data/work-order.json';
}

export function receiveItemFixturePath(env) {
    return testEnvironment(env) === 'prod' ? '../data/prod/receive-item.json' : '../data/recieve-item.json';
}
