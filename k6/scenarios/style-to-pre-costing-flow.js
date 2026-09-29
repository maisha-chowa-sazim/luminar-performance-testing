import { check } from 'k6';
import { setupAuth } from '../helpers/auth.js';
import { createBom } from '../flows/bom.js';
import { createPreCosting } from '../flows/pre-costing.js';
import { createSample } from '../flows/sample.js';
import { createStyle, getCreatedStyleId, getStyleDetails } from '../flows/style.js';
import { createTechPack } from '../flows/tech-pack.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    vus: 1,
    iterations: 1,
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

    const preCostingResponse = createPreCosting(token, styleId);
    check(preCostingResponse, {
        'pre-costing completed after style, sample, tech pack, and BOM': (resp) => isSuccessful(resp, 201),
    });
}