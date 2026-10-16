import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';

// Single local runner owns this durable, serialized ledger. No k6 global mutable state.
export async function startRoleCoordinator(directory, runId, config) {
    const secret = randomUUID();
    const workflows = new Map(), orders = new Map(), assignments = new Map();
    let duplicateAttempts = 0;
    const snapshot = () => {
        const entries = [...orders.values()];
        return { runId, config, workflows: [...workflows.values()], orders: entries,
            stats: {
                attempted: workflows.size, created: orders.size,
                ready: entries.filter(o => o.state === 'ready').length,
                claimed: entries.filter(o => o.state === 'claimed').length,
                received: entries.filter(o => o.state === 'received').length,
                failed: entries.filter(o => o.state === 'failed').length,
                pending: entries.filter(o => o.state !== 'received').length,
                duplicateAttempts,
            } };
    };
    const persist = () => {
        writeFileSync(`${directory}/handoff-ledger.tmp`, JSON.stringify(snapshot(), null, 2), { mode: 0o600 });
        renameSync(`${directory}/handoff-ledger.tmp`, `${directory}/handoff-ledger.json`);
    };
    const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
    const dispatch = (path, body) => {
        if (path === '/summary') return snapshot();
        if (path === '/account') {
            if (!['merchandiser', 'inventory'].includes(body.role) || !Number.isInteger(body.vu) || body.vu < 1) reject(400, 'Invalid VU assignment');
            const key = `${body.role}:${body.vu}`;
            if (!assignments.has(key)) {
                const index = [...assignments.keys()].filter(k => k.startsWith(`${body.role}:`)).length;
                if (index >= config[body.role]) reject(409, 'Role account capacity exceeded');
                assignments.set(key, index);
            }
            return { index: assignments.get(key) };
        }
        if (path === '/workflow') {
            if (!body.id || workflows.has(body.id)) reject(409, 'Workflow ID required and unique');
            workflows.set(body.id, { id: body.id, startedAt: Date.now(), state: 'started' });
            persist(); return { id: body.id };
        }
        if (path === '/workflow-failed') {
            const workflow = workflows.get(body.id);
            if (!workflow) reject(404, 'Workflow missing');
            workflow.state = 'failed'; workflow.step = body.step; workflow.kind = body.kind; workflow.httpStatus = body.httpStatus;
            if (body.errorCode === 'FEATURE_DISABLED') workflow.errorCode = body.errorCode;
            persist(); return { ok: true };
        }
        if (path === '/workflow-progress') {
            const workflow = workflows.get(body.id);
            if (!workflow || !body.step || !body.entityId) reject(400, 'Workflow and created entity required');
            (workflow.entities ||= {})[body.step] = body.entityId;
            persist(); return { ok: true };
        }
        if (path === '/orders') {
            if (!workflows.has(body.workflowId) || !body.id || !body.styleId || !body.purchaseOrderId || orders.has(body.id)) reject(409, 'Invalid or duplicate order registration');
            orders.set(body.id, { id: body.id, workflowId: body.workflowId, styleId: body.styleId,
                purchaseOrderId: body.purchaseOrderId, createdAt: Date.now(), state: 'created' });
            persist(); return { ok: true };
        }
        if (path === '/claim') {
            // Claims never expire or requeue automatically: a timed-out POST may have committed.
            if (typeof body.owner !== 'string' || !body.owner) reject(400, 'Claim owner required');
            const order = [...orders.values()].find(o => o.state === 'ready');
            if (!order) return { order: null };
            order.state = 'claimed'; order.owner = body.owner; order.claim = randomUUID(); order.claimedAt = Date.now();
            persist(); return { order: { ...order } };
        }
        const order = orders.get(body.id);
        if (!order) reject(404, 'Order not registered in this run');
        if (path === '/ready') {
            if (order.state !== 'created') reject(409, 'Order is not newly created');
            order.state = 'ready'; persist(); return { ok: true };
        }
        if (path === '/finish') {
            if (order.state === 'received') { duplicateAttempts++; persist(); reject(409, 'Order already received'); }
            if (order.state !== 'claimed' || order.claim !== body.claim || order.owner !== body.owner) reject(409, 'Claim mismatch');
            if (!body.grnId) reject(400, 'Verified GRN ID required');
            order.state = 'received'; order.grnId = body.grnId; order.receivedAt = Date.now();
            workflows.get(order.workflowId).state = 'received'; persist(); return { ok: true };
        }
        if (path === '/failed') {
            if (order.state === 'received') reject(409, 'Received order cannot fail');
            if (order.state === 'claimed' && (order.claim !== body.claim || order.owner !== body.owner)) reject(409, 'Claim mismatch');
            order.state = 'failed'; order.step = body.step; order.kind = body.kind; order.httpStatus = body.httpStatus;
            if (body.errorCode === 'FEATURE_DISABLED') order.errorCode = body.errorCode;
            // Preserve known partial effects, without response bodies or session material.
            order.grnId = body.grnId || null; order.receiptDispatched = body.receiptDispatched === true;
            persist(); return { ok: true };
        }
        reject(404, 'Unknown coordinator operation');
    };
    persist();
    const server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
            const supplied = Buffer.from(req.headers['x-coordinator-key'] || '');
            const expected = Buffer.from(secret);
            if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) reject(403, 'Forbidden');
            if (req.method !== 'POST') reject(405, 'POST required');
            let raw = '';
            for await (const chunk of req) { raw += chunk; if (raw.length > 65536) reject(413, 'Payload too large'); }
            const result = dispatch(req.url, JSON.parse(raw || '{}'));
            res.end(JSON.stringify(result));
        } catch (error) {
            res.statusCode = error.status || 500;
            res.end(JSON.stringify({ error: error.status ? error.message : 'Coordinator failure' }));
        }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}`, secret, snapshot,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections();
        }) };
}
