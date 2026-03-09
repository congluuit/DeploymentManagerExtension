import * as vscode from 'vscode';
/**
 * Minimal sidebar launcher shown under the Activity Bar rocket icon.
 * The rich dashboard itself opens as a closeable editor tab (WebviewPanel).
 */
export declare class DashboardLauncherProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly onDidChangeTreeDataEmitter;
    readonly onDidChangeTreeData: vscode.Event<void>;
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem;
    getChildren(element?: vscode.TreeItem): vscode.TreeItem[];
}
//# sourceMappingURL=dashboardLauncherProvider.d.ts.map