import { approveResource } from '../helpers/approvals.js';

export function bomApproval(token, resourceId, feedback = 'Approved by k6 BOM flow') {
    return approveResource({
        token,
        resourceType: 'bom',
        resourceId,
        feedback,
    });
}
