import { approveResource } from '../helpers/approvals.js';
import { login } from '../helpers/auth.js';
import { createBom, getCreatedBomId } from '../flows/bom.js';
import { createStyle, getCreatedStyleId, getStyleDetails } from '../flows/style.js';
import { FUNCTIONAL_THRESHOLDS } from '../config/functional-thresholds.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: FUNCTIONAL_THRESHOLDS,
};

export default function (data) {
    const token = data?.token || __ENV.SAVED_SESSION_TOKEN || '';
    const styleResponse = createStyle(token);
    const styleId = getCreatedStyleId(styleResponse);

    if (styleId) {
        const style = getStyleDetails(token, styleId);
        const styleComboId = style?.combos?.[0]?.id;
        const bomResponse = createBom(token, styleId, styleComboId);
        if (bomResponse?.status !== 201) {
            return;
        }

        const bomId = getCreatedBomId(bomResponse);
        if (!bomId) {
            return;
        }

        const executive = login('executive');
        if (executive?.token) {
            approveResource({
                token: executive.token,
                resourceType: 'bom',
                resourceId: bomId,
                feedback: 'Approved by k6 BOM flow',
            });
        }
    }
}