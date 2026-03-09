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
    private constructor();
    private handleMessage;
    private render;
    private collectData;
    private mapVercelDeployments;
    private buildStateCounts;
    private normalizeState;
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