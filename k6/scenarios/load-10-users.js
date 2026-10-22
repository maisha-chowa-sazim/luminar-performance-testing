import { createRoleScenario } from '../helpers/role-scenario.js';
import { roleScenarioEnvironment } from '../config/role-load.mjs';
export { merchandiserJourney as merchandiser, inventoryJourney as inventory } from '../flows/role-journeys.js';

const scenario = createRoleScenario(roleScenarioEnvironment(__ENV, 'load-10-users'));
export const options = scenario.options;
export const setup = scenario.setup;
export const teardown = scenario.teardown;
export default function () {} // Reporting wrapper compatibility.
