import { check } from 'k6';
import { login, setupAuth } from '../helpers/auth.js';
import { approveResource } from '../helpers/approvals.js';
import { createBom, getCreatedBomId } from '../flows/bom.js';
import { createPreCosting, getCreatedPreCostingId, submitPreCostingForApproval } from '../flows/pre-costing.js';
import { createSample } from '../flows/sample.js';
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

export default function (data) {
    const token = data?.token || '';
    const styleResponse = createStyle(token);
    const styleId = getCreatedStyleId(styleResponse);

    if (!styleId) {
        return;
    }

    const sampleResponse = createSample(token, styleId);
    if (!isSuccessful(sampleResponse, 201)) {
        return;
    }

    const techPackResponse = createTechPack(token, styleId);
    if (!isSuccessful(techPackResponse, 201)) {
        return;
    }

    const style = getStyleDetails(token, styleId);
    const styleComboId = style?.combos?.[0]?.id;
    const bomResponse = createBom(token, styleId, styleComboId);
    if (!isSuccessful(bomResponse, 201)) {
        return;
    }

    const bomId = getCreatedBomId(bomResponse);
    if (!bomId) {
        return;
    }

    const preCostingResponse = createPreCosting(token, styleId);
    if (!isSuccessful(preCostingResponse, 201)) {
        return;
    }

    const preCostingId = getCreatedPreCostingId(preCostingResponse);
    if (!preCostingId) {
        return;
    }

    const submissionResponse = submitPreCostingForApproval(token, styleId, preCostingId);
    if (submissionResponse?.status !== 200) {
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
        feedback: 'Approved by k6 BOM flow',
    });
    if (bomApproval?.status !== 201) {
        return;
    }

    const preCostingApproval = approveResource({
        token: executive.token,
        resourceType: 'pre-costing',
        resourceId: preCostingId,
        feedback: 'Approved by k6 pre-costing flow',
    });
    check(preCostingApproval, {
        'pre-costing approved after style, sample, tech pack, and BOM': (resp) => resp?.status === 201,
    });
}