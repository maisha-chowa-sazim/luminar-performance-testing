// Resolve actual existing credential conventions without exposing their values.
export function selectRoleAccounts(env, users, config) {
    const selected = {};
    const identities = new Set();
    for (const [role, count] of [['merchandiser', config.merchandiser], ['inventory', config.inventory], ['executive', 1], ['seniorMerchandiser', 1]]) {
        const definition = users[role];
        const prefix = definition.accountsEnvPrefix;
        let candidates;
        if (env[`${prefix}_ACCOUNT_COUNT`] !== undefined) {
            const available = Number(env[`${prefix}_ACCOUNT_COUNT`]);
            if (!Number.isInteger(available) || available < count || available > 1000) throw new Error(`Insufficient or invalid ${prefix}_ACCOUNT_COUNT: need ${count}`);
            candidates = Array.from({ length: count }, (_, i) => ({
                emailEnvKey: `${prefix}_ACCOUNT_${i + 1}_EMAIL`, passwordEnvKey: `${prefix}_ACCOUNT_${i + 1}_PASSWORD`,
            }));
        } else {
            candidates = (definition.accounts || [definition]).slice(0, count);
        }
        if (candidates.length < count) throw new Error(`Insufficient ${role} accounts: need ${count}`);
        selected[role] = candidates.map((account, index) => {
            for (const key of [account.emailEnvKey, account.passwordEnvKey]) {
                if (!String(env[key] || '').trim()) throw new Error(`Missing credential variable: ${key}`);
            }
            const identity = env[account.emailEnvKey].trim().toLowerCase();
            if (identities.has(identity)) throw new Error(`Duplicate identity assigned to ${role} account ${index + 1}`);
            identities.add(identity);
            return { ...account, role, label: `${role}_${index + 1}` };
        });
    }
    return selected;
}
