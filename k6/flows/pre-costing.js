import { approveResource } from '../helpers/approvals.js';

export function preCostingApproval(token, resourceId, feedback = 'Approved by k6 pre-costing flow') {
    return approveResource({
        token,
        resourceType: 'pre-costing',
        resourceId,
        feedback,
    });
}
