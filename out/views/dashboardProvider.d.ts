import * as vscode from 'vscode';
import { DashboardItemType, ProjectInfo } from '../utils/types';
/**
 * A single item in the deployment dashboard tree.
 */
export declare class DashboardItem extends vscode.TreeItem {
    readonly label: string;
    readonly itemType: DashboardItemType;
    readonly collapsibleState: vscode.TreeItemCollapsibleState;
    readonly meta?: {
        provider?: string;
        projectId?: string;
        projectName?: string;
    } | undefined;
    constructor(label: string, itemType: DashboardItemType, collapsibleState: vscode.TreeItemCollapsibleState, meta?: {
        provider?: string;
        projectId?: string;
        projectName?: string;
    } | undefined);
    private setupAppearance;
}
/**
 * TreeDataProvider for the Deployment Manager sidebar dashboard.
 * Displays project info, provider status, project lists, and actions.
 */
export declare class DashboardProvider implements vscode.TreeDataProvider<DashboardItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<void | DashboardItem | null | undefined>;
    private projectInfo;
    private vercelConnected;
    private coolifyConnected;
    private netlifyConnected;
    private vercelProjects;
    private coolifyApps;
    private netlifySites;
    private projectExistsOnVercel;
    private projectExistsOnCoolify;
    private projectExistsOnNetlify;
    private isLoading;
    /** Refresh the tree view data. */
    refresh(): Promise<void>;
    /** Whether the current project exists on any provider. */
    get projectExistsRemotely(): boolean;
    /** Get the detected project info. */
    getProjectInfo(): ProjectInfo | null;
    getTreeItem(element: DashboardItem): vscode.TreeItem;
    getChildren(element?: DashboardItem): Promise<DashboardItem[]>;
    private getRootItems;
    private getProjectItems;
    private getProviderItems;
    private getVercelProjectItems;
    private getCoolifyAppItems;
    private getNetlifySiteItems;
    private getActionItems;
}
//# sourceMappingURL=dashboardProvider.d.ts.map