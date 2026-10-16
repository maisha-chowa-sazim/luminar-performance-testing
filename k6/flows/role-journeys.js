import { sleep } from 'k6';
import execution from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import { createStyle } from './style.js';
import { createTechPack } from './tech-pack.js';
import { createSample } from './sample.js';
import { createBom } from './bom.js';
import { createPreCosting } from './pre-costing.js';
import { createPurchaseOrder } from './purchase-order.js';
import { createWorkOrder, approveWorkOrder, sendWorkOrderToSupplier } from './work-order.js';
import { uniqueId } from '../helpers/unique-id.js';
import { coordinate, sessionFor, think, requireCondition, responseData, operation,
    readApplication, writeApplication, duplicateReceipts, duplicateAttempts } from '../helpers/role-runtime.js';

const attempted = new Counter('merchandiser_attempted');
const merchantSuccess = new Rate('merchandiser_success');
const merchantFailed = new Counter('merchandiser_failed');
const merchantCompleted = new Counter('merchandiser_completed');
const inventorySuccess = new Rate('inventory_success');
const inventoryFailed = new Counter('inventory_failed');
const failures = new Counter('workflow_step_failed');
const noWork = new Counter('inventory_empty_polls');
const createdOrders = new Counter('created_work_orders');
const claimedOrders = new Counter('claimed_work_orders');
const inventoryCompleted = new Counter('inventory_completed');
const elapsed = new Trend('merchandiser_elapsed_duration', true);
let assignment;
let loginPause = false;
let workflowsStarted = 0;

function assigned(data, role) {
    if (assignment === undefined) assignment = coordinate('/account', { role, vu: execution.vu.idInTest }).index;
    const session = sessionFor(data, role, assignment, data.config);
    if (!loginPause) { think('login', data.config); loginPause = true; }
    return session;
}

export function merchandiserJourney(data) {
    const config = data.config;
    // Do not start new producer workflows once the scheduled ramp-down ends.
    if (Date.now() >= data.startedAt + config.producerSeconds * 1000) { sleep(config.pollInterval); return; }
    if (config.maxWorkflowsPerVU && workflowsStarted >= config.maxWorkflowsPerVU) { sleep(config.pollInterval); return; }
    workflowsStarted++;
    const workflowId = `${data.runId}-${uniqueId()}`;
    let step = 'handoff_start', orderId, started = false, ok = false;
    const start = Date.now();
    const at = (name, fn) => { step = name; return operation(name, fn); };
    try {
        coordinate('/workflow', { id: workflowId }); started = true; attempted.add(1);
        const session = at('login', () => assigned(data, 'merchandiser'));
        const create = (name, fn) => at(name, () => {
            const entity = responseData(fn(), 201, name, session);
            requireCondition(typeof entity?.id === 'string' && !!entity.id, `${name}_id`);
            coordinate('/workflow-progress', { id: workflowId, step: name, entityId: entity.id });
            return entity;
        });
        const style = create('style_create', () => createStyle(session.token, data.runId)); think('style', config);
        create('tech_pack_create', () => createTechPack(session.token, style.id)); think('techpack', config);
        const sample = create('sample_create', () => createSample(session.token, style.id));
        requireCondition(sample.styleId === style.id, 'sample_style_relationship', 'integrity'); think('sample', config);
        const details = at('style_get', () => readApplication(`/api/v1/styles/${style.id}`, 'style_get', session, config));
        requireCondition(details?.id === style.id && !!details?.combos?.[0]?.id, 'style_relationship', 'integrity');
        const bom = create('bom_create', () => createBom(session.token, style.id, details.combos[0].id));
        requireCondition(bom.styleId === style.id, 'bom_style_relationship', 'integrity'); think('bom', config);
        const costing = create('pre_costing_create', () => createPreCosting(session.token, style.id)); think('costing', config);
        const purchase = create('purchase_order_create', () => createPurchaseOrder(session.token, style.id, details.combos[0].id, data.runId));
        requireCondition(purchase.styles?.some(value => value.id === style.id), 'purchase_style_relationship', 'integrity'); think('purchase', config);
        const order = create('work_order_create', () => createWorkOrder(session.token, purchase.id, style.id));
        orderId = order.id;
        coordinate('/orders', { id: orderId, workflowId, styleId: style.id, purchaseOrderId: purchase.id });
        createdOrders.add(1);
        const senior = sessionFor(data, 'seniorMerchandiser', 0, config);
        at('approval_work_order', () => responseData(approveWorkOrder(senior.token, orderId), 201, step, senior));
        at('work_order_sent_to_supplier', () => responseData(sendWorkOrderToSupplier(senior.token, orderId), 200, step, senior));
        const ready = at('work_order_get', () => readApplication(`/api/v1/work-orders/${orderId}`, 'work_order_get', session, config,
            value => value.status === 'SENT_TO_SUPPLIER'));
        validateOrder(ready, { id: orderId, styleId: style.id, purchaseOrderId: purchase.id });
        at('handoff_ready', () => coordinate('/ready', { id: orderId }));
        merchantCompleted.add(1); ok = true;
    } catch (error) {
        step = error.step || step;
        merchantFailed.add(1); failures.add(1, { role: 'merchandiser', step });
        const diagnostic = { kind: error.kind || 'script_or_polling', httpStatus: error.httpStatus || null, errorCode: error.errorCode };
        console.warn(`Merchandiser workflow failed at ${step} (${diagnostic.kind}); details retained in run ledger`);
        if (started) coordinate('/workflow-failed', { id: workflowId, step, ...diagnostic });
        if (orderId) coordinate('/failed', { id: orderId, step, ...diagnostic });
        if (__ENV.ROLE_STOP_ON_ERROR === '1') execution.test.abort(`Merchandiser failed at ${step} (${diagnostic.kind})`);
        sleep(config.pollInterval);
    } finally { merchantSuccess.add(ok); elapsed.add(Date.now() - start); }
}

export function validateOrder(order, claim) {
    requireCondition(order?.id === claim.id && Array.isArray(order.items) && order.items.length > 0, 'work_order_identity', 'integrity');
    const variants = order.items.flatMap(item => item.variants || []);
    requireCondition(variants.length > 0 && new Set(variants.map(v => v.id)).size === variants.length &&
        variants.every(v => v.id && v.style?.id === claim.styleId && v.purchaseOrder?.id === claim.purchaseOrderId),
    'work_order_dependencies', 'integrity');
    return variants;
}

export function receivableItems(order, claim) {
    validateOrder(order, claim);
    requireCondition(order.status === 'SENT_TO_SUPPLIER', 'work_order_receivable_state', 'integrity');
    return order.items.flatMap(item => (item.variants || []).map(variant => {
        const quantity = Number(variant.quantity), received = Number(variant.receivedQuantity);
        requireCondition(variant.receivedQuantity !== null && variant.receivedQuantity !== undefined &&
            Number.isFinite(quantity) && quantity > 0 && received === 0 && !!item.measurementUnit,
        'work_order_initial_quantity', 'quantity');
        return { poItemVariantId: variant.id, receivedQuantity: quantity, measurementUnit: item.measurementUnit };
    }));
}

export function validateReceipt(grn, claim, items) {
    requireCondition(!!grn?.id && grn.workOrder?.id === claim.id && Array.isArray(grn.items) && grn.items.length === items.length,
        'grn_relationship', 'integrity');
    requireCondition(new Set(grn.items.map(item => item.poItemVariant?.id)).size === items.length &&
        items.every(expected => {
            const actual = grn.items.find(item => item.poItemVariant?.id === expected.poItemVariantId);
            return actual?.id && Number(actual.receivedQuantity) === expected.receivedQuantity && actual.measurementUnit === expected.measurementUnit;
        }), 'grn_quantities', 'quantity');
}

export function inventoryJourney(data) {
    const config = data.config;
    let step = 'login', claim, grnId, receiptDispatched = false, ok = false;
    const owner = `inventory:${execution.vu.idInTest}`;
    const at = (name, fn) => { step = name; return operation(name, fn); };
    try {
        const session = assigned(data, 'inventory');
        claim = at('handoff_claim', () => coordinate('/claim', { owner })).order;
        if (!claim) { noWork.add(1); sleep(config.pollInterval); return; }
        claimedOrders.add(1);
        const order = at('work_order_find', () => readApplication(`/api/v1/work-orders/${claim.id}`, 'work_order_find', session, config));
        const items = receivableItems(order, claim);
        const beforeReceipts = at('grn_list', () => readApplication(`/api/v1/grn/list?workOrderId=${claim.id}&page=1&limit=2`, 'grn_list', session, config));
        requireCondition(Array.isArray(beforeReceipts.data) && Number.isInteger(beforeReceipts.meta?.total), 'grn_list_contract');
        if (beforeReceipts.meta.total > 0) duplicateAttempts.add(1);
        requireCondition(beforeReceipts.meta.total === 0 && beforeReceipts.data.length === 0, 'no_previous_receipts', 'integrity');
        think('discover', config);
        const payload = { workOrderId: claim.id, grnNumber: `GRN-${data.runId}-${uniqueId()}`,
            receivedAt: new Date().toISOString(), items };
        // No write retries, including timeouts, 401, 409, 429, and 5xx responses.
        const grn = at('grn_create', () => {
            receiptDispatched = true;
            return responseData(writeApplication('POST', '/api/v1/grn', payload, 'grn_create', session), 201, step, session);
        });
        grnId = grn.id;
        validateReceipt(grn, claim, items);
        const persisted = at('grn_get', () => readApplication(`/api/v1/grn/${grnId}`, 'grn_get', session, config));
        validateReceipt(persisted, claim, items);
        const after = at('work_order_get', () => readApplication(`/api/v1/work-orders/${claim.id}`, 'work_order_get', session, config,
            value => value.status === 'RECEIVED', value => {
                const current = validateOrder(value, claim);
                requireCondition(items.every(item => Number(current.find(v => v.id === item.poItemVariantId)?.receivedQuantity) === item.receivedQuantity),
                    'work_order_received_quantity', 'quantity');
            }));
        const variants = validateOrder(after, claim);
        requireCondition(items.every(item => Number(variants.find(v => v.id === item.poItemVariantId)?.receivedQuantity) === item.receivedQuantity),
            'work_order_received_quantity', 'quantity');
        const receipts = at('grn_list', () => readApplication(`/api/v1/grn/list?workOrderId=${claim.id}&page=1&limit=2`, 'grn_list', session, config));
        if (receipts.meta?.total > 1) duplicateReceipts.add(receipts.meta.total - 1);
        requireCondition(receipts.meta?.total === 1 && receipts.data?.length === 1 && receipts.data[0].id === grnId,
            'exactly_one_successful_receipt', 'integrity');
        at('handoff_finish', () => coordinate('/finish', { id: claim.id, owner, claim: claim.claim, grnId }));
        inventoryCompleted.add(1);
        ok = true;
    } catch (error) {
        step = error.step || step;
        inventoryFailed.add(1); failures.add(1, { role: 'inventory', step });
        const diagnostic = { kind: error.kind || 'script_or_polling', httpStatus: error.httpStatus || null, errorCode: error.errorCode };
        console.warn(`Inventory workflow failed at ${step} (${diagnostic.kind}); do not replay receipt without reconciliation`);
        if (claim) coordinate('/failed', { id: claim.id, owner, claim: claim.claim, step, grnId, receiptDispatched, ...diagnostic });
        if (__ENV.ROLE_STOP_ON_ERROR === '1') execution.test.abort(`Inventory failed at ${step} (${diagnostic.kind})`);
        sleep(config.pollInterval);
    } finally { if (claim) inventorySuccess.add(ok); }
}
