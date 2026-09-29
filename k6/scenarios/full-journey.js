import { check } from 'k6';
import { approveResource } from '../helpers/approvals.js';
import { login, setupAuth } from '../helpers/auth.js';
import { createBom, getCreatedBomId } from '../flows/bom.js';
import { createPreCosting, getCreatedPreCostingId, submitPreCostingForApproval } from '../flows/pre-costing.js';
import { createPurchaseOrder, getCreatedPurchaseOrderId } from '../flows/purchase-order.js';
import { createReceiveItem } from '../flows/receive-item.js';
import { createSample } from '../flows/sample.js';
import {
    approveWorkOrder,
    createWorkOrder,
    getCreatedWorkOrderId,
    getCreatedWorkOrderVariantId,
    sendWorkOrderToSupplier,
} from '../flows/work-order.js';
import { createStyle, getCreatedStyleId, getStyleDetails } from '../flows/style.js';
import { createTechPack } from '../flows/tech-pack.js';
import { FUNCTIONAL_THRESHOLDS } from '../config/functional-thresholds.js';

export { setupAuth as setup } from '../helpers/auth.js';

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

function executeJourney(data) {
    const merchandiserToken = data?.token || '';
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

    const costingSubmission = submitPreCostingForApproval(merchandiserToken, styleId, costingId);
    if (costingSubmission?.status !== 200) {
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

    const executive = login('executive');
    if (!executive?.token) {
        return;
    }

    const bomApproval = approveResource({
        token: executive.token,
        resourceType: 'bom',
        resourceId: bomId,
        feedback: 'Approved by k6 full journey',
    });
    if (bomApproval?.status !== 201) {
        return;
    }

    const costingApproval = approveResource({
        token: executive.token,
        resourceType: 'pre-costing',
        resourceId: costingId,
        feedback: 'Approved by k6 full journey',
    });
    if (costingApproval?.status !== 201) {
        return;
    }

    const purchaseOrderApproval = approveResource({
        token: executive.token,
        resourceType: 'purchase',
        resourceId: purchaseOrderId,
        feedback: 'Approved by k6 full journey',
    });
    if (purchaseOrderApproval?.status !== 201) {
        return;
    }

    const seniorMerchandiser = login('seniorMerchandiser');
    if (!seniorMerchandiser?.token) {
        return;
    }

    const workOrderApproval = approveWorkOrder(seniorMerchandiser.token, workOrderId);
    if (workOrderApproval?.status !== 201) {
        return;
    }

    const supplierStatus = sendWorkOrderToSupplier(seniorMerchandiser.token, workOrderId);
    if (supplierStatus?.status !== 200) {
        return;
    }

    const inventory = login('inventory');
    if (!inventory?.token) {
        return;
    }

    const grnResponse = createReceiveItem(inventory.token, workOrderId, workOrderVariantId);
    return isSuccessful(grnResponse, 201);
}

export default function (data) {
    let completed = false;
    try {
        completed = executeJourney(data) === true;
        return completed;
    } finally {
        check(completed, {
            'full journey completed through item receipt': (value) => value === true,
        });
    }
}
