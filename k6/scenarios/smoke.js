import { login, setupAuth } from '../helpers/auth.js';
import { approveResource } from '../helpers/approvals.js';
import { createStyle, getCreatedStyleId, getStyleDetails } from '../flows/style.js';
import { createPurchaseOrder, getCreatedPurchaseOrderId } from '../flows/purchase-order.js';
import { FUNCTIONAL_THRESHOLDS } from '../config/functional-thresholds.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        ...FUNCTIONAL_THRESHOLDS,
        http_req_failed: ['rate<0.05'],
        http_req_duration: ['p(95)<3000'],
    },
};

export default function (data) {
    const token = data?.token || __ENV.SAVED_SESSION_TOKEN || '';
    const styleResponse = createStyle(token);
    const styleId = getCreatedStyleId(styleResponse);

    if (styleId) {
        const style = getStyleDetails(token, styleId);
        const styleComboId = style?.combos?.[0]?.id;
        if (!styleComboId) {
            return;
        }

        const purchaseOrderResponse = createPurchaseOrder(token, styleId, styleComboId);
        if (purchaseOrderResponse?.status !== 201) {
            return;
        }

        const purchaseOrderId = getCreatedPurchaseOrderId(purchaseOrderResponse);
        if (!purchaseOrderId) {
            return;
        }

        const executive = login('executive');
        if (executive?.token) {
            approveResource({
                token: executive.token,
                resourceType: 'purchase',
                resourceId: purchaseOrderId,
                feedback: 'Approved by k6 purchase-order flow',
            });
        }
    }
}
