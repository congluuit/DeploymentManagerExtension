import * as vscode from 'vscode';

class DashboardLauncherItem extends vscode.TreeItem {
    constructor() {
        super('Open Deployment Dashboard', vscode.TreeItemCollapsibleState.None);

        this.id = 'deploymentManager.dashboardLauncher.open';
        this.description = 'Open in new tab';
        this.tooltip = 'Open the Deployment Manager dashboard in a closeable editor tab';
        this.iconPath = new vscode.ThemeIcon('rocket');
        this.command = {
            command: 'deploymentManager.openDashboard',
            title: 'Open Deployment Dashboard',
        };
        this.contextValue = 'dashboardLauncher';
    }
}

/**
 * Minimal sidebar launcher shown under the Activity Bar rocket icon.
 * The rich dashboard itself opens as a closeable editor tab (WebviewPanel).
 */
export class DashboardLauncherProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (element) {
            return [];
        }

        const openDashboardItem = new DashboardLauncherItem();

        const hintItem = new vscode.TreeItem(
            'Click the rocket icon any time to reopen the dashboard',
            vscode.TreeItemCollapsibleState.None
        );
        hintItem.id = 'deploymentManager.dashboardLauncher.hint';
        hintItem.iconPath = new vscode.ThemeIcon('lightbulb-autofix');
        hintItem.description = 'Dashboard tab can be closed when idle';

        return [openDashboardItem, hintItem];
    }
}
