// Resolve the fixture's relative date using its explicit business timezone.
export function shipmentDate(rule, now = Date.now()) {
    if (!Number.isInteger(rule?.daysFromToday) || rule.daysFromToday < 1 ||
        !Number.isInteger(rule.utcOffsetMinutes) || Math.abs(rule.utcOffsetMinutes) > 840 || !Number.isFinite(now)) {
        throw new Error('Invalid shipment date rule in k6/data/purchase.json');
    }
    const date = new Date(now + rule.utcOffsetMinutes * 60_000);
    date.setUTCDate(date.getUTCDate() + rule.daysFromToday);
    return date.toISOString().slice(0, 10);
}
