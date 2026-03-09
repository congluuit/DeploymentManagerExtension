import * as vscode from 'vscode';
/**
 * Rich deployment dashboard shown as a closeable editor tab.
 * Opened by clicking the rocket icon container.
 */
export declare class DashboardPanel {
    private static currentPanel;
    static createOrShow(extensionUri: vscode.Uri, runRefresh: () => Promise<void>): void;
    static refreshCurrentPanel(): void;
    private readonly panel;
    private readonly extensionUri;
    private runRefresh;
    private readonly disposables;
    private readonly execFileAsync;
    private constructor();
    private handleMessage;
    private isProviderName;
    private resolveSiteUrl;
    private importEnvForResource;
    private parseDotEnv;
    private render;
    private collectData;
    private mapVercelDeployments;
    private mapNetlifyDeployments;
    private buildStateCounts;
    private normalizeState;
    private buildManagedResources;
    private toManagedStatus;
    private toManagedStatusLabel;
    private getVercelState;
    private buildVercelStatusDetail;
    private extractVercelSource;
    private normalizePublicUrl;
    private matchesWorkspaceOnVercel;
    private matchesWorkspaceOnCoolify;
    private matchesWorkspaceOnNetlify;
    private normalizeRepoIdentifier;
    private getLatestVercelDeployment;
    private getLatestNetlifyDeploy;
    private getWorkspaceLatestCommitLabel;
    private getLatestCommitFromLocalGit;
    private getManagedResourceRowHtml;
    private getManagedResourcesBodyHtml;
    private getManagedProviderSectionHtml;
    private getDashboardHtml;
    private getLoadingHtml;
    private getErrorHtml;
    private dispose;
    private static normalizeTimestamp;
    private static formatTimestamp;
    private static formatRelativeTime;
    private static toTitleCase;
    private static escapeHtml;
    private static getNonce;
}
//# sourceMappingURL=dashboardPanel.d.ts.map