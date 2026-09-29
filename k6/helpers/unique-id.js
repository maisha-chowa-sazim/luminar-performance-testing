import exec from 'k6/execution';
let sequence = 0;
export function uniqueId() {
    return `${Date.now()}-${exec.vu.idInTest}-${sequence++}-${Math.random().toString(36).slice(2, 8)}`;
}
