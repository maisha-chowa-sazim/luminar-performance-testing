import { createStyle, getCreatedStyleId } from '../flows/style.js';
import { createTechPack } from '../flows/tech-pack.js';
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
        createTechPack(token, styleId);
    }
}