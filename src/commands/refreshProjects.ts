/**
 * Refresh the project lists from all connected providers.
 * This is a simple passthrough that triggers the dashboard refresh.
 */
export async function refreshProjects(dashboardRefresh: () => void): Promise<void> {
    dashboardRefresh();
}
