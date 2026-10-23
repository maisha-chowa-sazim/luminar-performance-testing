export function testType(metadata) {
    if (metadata.testType) return metadata.testType;
    const scenario = metadata.scenario || 'unknown';
    const load = scenario.match(/^load-(\d+)-users$/);
    if (load) return `load:${load[1]}`;
    if (scenario === 'load-roles') return metadata.roleConfiguration?.maxWorkflowsPerVU === 1 ? 'roles:smoke' : 'roles';
    return scenario.replace('test-scenarios/', '');
}

export function runTestType(scenario, env, roleConfiguration) {
    const command = env.npm_lifecycle_event;
    return command?.startsWith('test:') && command !== 'test:performance' && command !== 'test:dashboard'
        ? command.slice(5) : testType({ scenario, roleConfiguration });
}

export function testTypeSlug(type) {
    return type.replace(/[^a-zA-Z0-9-]+/g, '-');
}

export function testTypeLabel(metadata) {
    const type = testType(metadata);
    const load = type.match(/^load:(\d+)$/);
    if (load) return `LoadTest : ${load[1]} VU`;
    const total = metadata.roleConfiguration?.total;
    if (type.includes('smoke')) return Number.isFinite(total) ? `Smoke Test : ${total} VU` : 'Smoke Test';
    if (type === 'roles') return Number.isFinite(total) ? `LoadTest : ${total} VU` : 'LoadTest';
    return type;
}
