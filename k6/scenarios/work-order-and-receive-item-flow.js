import { login, setupAuth } from '../helpers/auth.js';
import { createReceiveItem } from '../flows/receive-item.js';
import { approveWorkOrder, createWorkOrder, getCreatedWorkOrderId, getCreatedWorkOrderVariantId, sendWorkOrderToSupplier } from '../flows/work-order.js';
import { FUNCTIONAL_THRESHOLDS } from '../config/functional-thresholds.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: FUNCTIONAL_THRESHOLDS,
};

export default function (data) {
    const merchandiserToken = data?.token || '';
    const workOrderResp = createWorkOrder(merchandiserToken);
    const workOrderId = getCreatedWorkOrderId(workOrderResp);
    const poItemVariantId = getCreatedWorkOrderVariantId(workOrderResp);

    if (!workOrderId || !poItemVariantId) {
        return;
    }

    const seniorMerchandiser = login('seniorMerchandiser');
    if (!seniorMerchandiser?.token) {
        return;
    }

    const approvalResp = approveWorkOrder(seniorMerchandiser.token, workOrderId);
    if (approvalResp?.status !== 201) {
        return;
    }

    const statusResp = sendWorkOrderToSupplier(seniorMerchandiser.token, workOrderId);
    if (statusResp?.status !== 200) {
        return;
    }

    const inventory = login('inventory');
    if (!inventory?.token) {
        return;
    }

    createReceiveItem(inventory.token, workOrderId, poItemVariantId);
}
