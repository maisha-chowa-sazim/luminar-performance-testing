import { createBom } from '../flows/bom.js';
import { createStyle, getCreatedStyleId, getStyleDetails } from '../flows/style.js';

export { setupAuth as setup } from '../helpers/auth.js';

export const options = {
    vus: 1,
    iterations: 1,
};

export default function (data) {
    const token = data?.token || __ENV.SAVED_SESSION_TOKEN || '';
    const styleResponse = createStyle(token);
    const styleId = getCreatedStyleId(styleResponse);

    if (styleId) {
        const style = getStyleDetails(token, styleId);
        const styleComboId = style?.combos?.[0]?.id;
        createBom(token, styleId, styleComboId);
    }
}