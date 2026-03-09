"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshProjects = refreshProjects;
/**
 * Refresh the project lists from all connected providers.
 * This is a simple passthrough that triggers the dashboard refresh.
 */
async function refreshProjects(dashboardRefresh) {
    dashboardRefresh();
}
//# sourceMappingURL=refreshProjects.js.map