import { check } from 'k6';
import { testEnvironment } from '../config/environment.mjs';
import { login } from '../helpers/auth.js';
import { createBom, getCreatedBomId } from '../flows/bom.js';
import { createPreCosting, getCreatedPreCostingId } from '../flows/pre-costing.js';
import { createPurchaseOrder, getCreatedPurchaseOrderId } from '../flows/purchase-order.js';
import { createReceiveItem } from '../flows/receive-item.js';
import { createSample } from '../flows/sample.js';
import {
    createWorkOrder,
    approveWorkOrder,
    sendWorkOrderToSupplier,
    getCreatedWorkOrderId,
    getCreatedWorkOrderVariantId,
} from '../flows/work-order.js';
import { createStyle, getCreatedStyleId, getStyleDetails } from '../flows/style.js';
import { createTechPack } from '../flows/tech-pack.js';
import { FUNCTIONAL_THRESHOLDS } from '../config/functional-thresholds.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: FUNCTIONAL_THRESHOLDS,
};

function isSuccessful(resp, expectedStatus) {
    if (resp?.status !== expectedStatus) {
        return false;
    }

    try {
        return resp.json()?.success === true;
    } catch (err) {
        return false;
    }
}

function executeJourney(sessions) {
    const merchandiser = (sessions ? sessions.merchandiser : login('merchandiser'));
    if (!merchandiser?.token) {
        return;
    }
    const merchandiserToken = merchandiser.token;
    const styleResponse = createStyle(merchandiserToken);
    const styleId = getCreatedStyleId(styleResponse);
    if (!styleId) {
        return;
    }

    const sampleResponse = createSample(merchandiserToken, styleId);
    if (!isSuccessful(sampleResponse, 201)) {
        return;
    }

    const techPackResponse = createTechPack(merchandiserToken, styleId);
    if (!isSuccessful(techPackResponse, 201)) {
        return;
    }

    const style = getStyleDetails(merchandiserToken, styleId);
    const styleComboId = style?.combos?.[0]?.id;
    const bomResponse = createBom(merchandiserToken, styleId, styleComboId);
    if (!isSuccessful(bomResponse, 201)) {
        return;
    }

    const bomId = getCreatedBomId(bomResponse);
    if (!bomId) {
        return;
    }

    const costingResponse = createPreCosting(merchandiserToken, styleId);
    if (!isSuccessful(costingResponse, 201)) {
        return;
    }

    const costingId = getCreatedPreCostingId(costingResponse);
    if (!costingId) {
        return;
    }

    const purchaseOrderResponse = createPurchaseOrder(merchandiserToken, styleId, styleComboId);
    if (!isSuccessful(purchaseOrderResponse, 201)) {
        return;
    }

    const purchaseOrderId = getCreatedPurchaseOrderId(purchaseOrderResponse);
    if (!purchaseOrderId) {
        return;
    }

    const workOrderResponse = createWorkOrder(merchandiserToken, purchaseOrderId, styleId);
    if (!isSuccessful(workOrderResponse, 201)) {
        return;
    }

    const workOrderId = getCreatedWorkOrderId(workOrderResponse);
    const workOrderVariantId = getCreatedWorkOrderVariantId(workOrderResponse);
    if (!workOrderId || !workOrderVariantId) {
        return;
    }

    const senior = sessions ? sessions.seniorMerchandiser : login('seniorMerchandiser');
    if (!senior?.token) return;
    if (!isSuccessful(approveWorkOrder(senior.token, workOrderId), 201)) return;
    if (!isSuccessful(sendWorkOrderToSupplier(senior.token, workOrderId), 200)) return;

    const inventory = (sessions ? sessions.inventory : login('inventory'));
    if (!inventory?.token) {
        return;
    }

    const grnResponse = createReceiveItem(inventory.token, workOrderId, testEnvironment(__ENV) === 'prod'
        ? workOrderResponse.json().data.items.flatMap(item => item.variants.map(variant => variant.id))
        : workOrderVariantId);
    return isSuccessful(grnResponse, 201);
}

export default function (sessions) {
    let completed = false;
    try {
        completed = executeJourney(sessions) === true;
        return completed;
    } finally {
        check(completed, {
            'full journey completed through item receipt': (value) => value === true,
        });
    }
}
