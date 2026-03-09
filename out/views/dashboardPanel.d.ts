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
    private render;
    private collectData;
    private mapVercelDeployments;
    private mapNetlifyDeployments;
    private buildStateCounts;
    private normalizeState;
    private buildManagedResources;
    private getLatestGitCommit;
    private parseRepoIdentifier;
    private getLatestVercelDeployment;
    private getLatestNetlifyDeploy;
    private extractCommitSha;
    private getWorkspaceLatestCommitLabel;
    private getLatestCommitFromLocalGit;
    private getManagedResourceRowHtml;
    private getManagedResourcesBodyHtml;
    private getDashboardHtml;
    private getLoadingHtml;
    private getErrorHtml;
    private dispose;
    private static normalizeTimestamp;
    private static formatTimestamp;
    private static escapeHtml;
    private static getNonce;
}
//# sourceMappingURL=dashboardPanel.d.ts.map