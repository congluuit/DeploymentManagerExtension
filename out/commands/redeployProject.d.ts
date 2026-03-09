export interface RedeployTarget {
    provider: 'Vercel' | 'Coolify';
    id: string;
    name: string;
}
export interface RedeployOptions {
    target?: RedeployTarget;
    notify?: boolean;
}
export interface RedeployResult {
    success: boolean;
    error?: string;
}
/**
 * Redeploy an existing project.
 * Enforces the "redeploy only if already exists" rule.
 */
export declare function redeployProject(dashboardRefresh: () => void, options?: RedeployOptions): Promise<RedeployResult>;
//# sourceMappingURL=redeployProject.d.ts.map