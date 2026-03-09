import * as vscode from 'vscode';
import { VercelClient } from '../clients/vercelClient';
import { CoolifyClient } from '../clients/coolifyClient';
import { NetlifyClient } from '../clients/netlifyClient';
import { ProjectDetector } from '../services/projectDetector';
import { SecretStorageManager } from '../utils/secretStorage';
import {
    StorageKeys,
    DashboardItemType,
    ProjectInfo,
    VercelProject,
    CoolifyApplication,
    NetlifySite,
} from '../utils/types';

/**
 * A single item in the deployment dashboard tree.
 */
export class DashboardItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: DashboardItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly meta?: {
            provider?: string;
            projectId?: string;
            projectName?: string;
        }
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.setupAppearance();
    }

    private setupAppearance(): void {
        switch (this.itemType) {
            case 'header':
                this.iconPath = new vscode.ThemeIcon('symbol-folder');
                break;
            case 'projectInfo':
                this.iconPath = new vscode.ThemeIcon('repo');
                break;
            case 'providerStatus':
                this.iconPath = new vscode.ThemeIcon('cloud');
                break;
            case 'vercelProject':
                this.iconPath = new vscode.ThemeIcon('globe');
                this.contextValue = 'vercelProject';
                break;
            case 'coolifyApp':
                this.iconPath = new vscode.ThemeIcon('server');
                this.contextValue = 'coolifyApp';
                break;
            case 'netlifySite':
                this.iconPath = new vscode.ThemeIcon('cloud');
                this.contextValue = 'netlifySite';
                break;
            case 'deployAction':
                this.iconPath = new vscode.ThemeIcon('cloud-upload');
                this.contextValue = 'deployAction';
                this.command = {
                    command: 'deploymentManager.deployProject',
                    title: 'Deploy Project',
                };
                break;
            case 'redeployAction':
                this.iconPath = new vscode.ThemeIcon('sync');
                this.contextValue = 'redeployAction';
                this.command = {
                    command: 'deploymentManager.redeployProject',
                    title: 'Redeploy Project',
                };
                break;
            case 'connectAction':
                this.iconPath = new vscode.ThemeIcon('plug');
                break;
            case 'noItems':
                this.iconPath = new vscode.ThemeIcon('info');
                break;
        }
    }
}

/**
 * TreeDataProvider for the Deployment Manager sidebar dashboard.
 * Displays project info, provider status, project lists, and actions.
 */
export class DashboardProvider implements vscode.TreeDataProvider<DashboardItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DashboardItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private projectInfo: ProjectInfo | null = null;
    private vercelConnected = false;
    private coolifyConnected = false;
    private netlifyConnected = false;
    private vercelProjects: VercelProject[] = [];
    private coolifyApps: CoolifyApplication[] = [];
    private netlifySites: NetlifySite[] = [];
    private projectExistsOnVercel = false;
    private projectExistsOnCoolify = false;
    private projectExistsOnNetlify = false;
    private isLoading = false;

    /** Refresh the tree view data. */
    async refresh(): Promise<void> {
        this.isLoading = true;
        this._onDidChangeTreeData.fire();

        try {
            // Detect project
            const detector = new ProjectDetector();
            this.projectInfo = await detector.detect();

            // Check provider connections
            const storage = SecretStorageManager.getInstance();
            this.vercelConnected = await storage.has(StorageKeys.VERCEL_TOKEN);
            this.coolifyConnected = await storage.has(StorageKeys.COOLIFY_TOKEN);
            this.netlifyConnected = await storage.has(StorageKeys.NETLIFY_TOKEN);

            // Fetch projects from connected providers
            this.vercelProjects = [];
            this.coolifyApps = [];
            this.netlifySites = [];
            this.projectExistsOnVercel = false;
            this.projectExistsOnCoolify = false;
            this.projectExistsOnNetlify = false;

            if (this.vercelConnected) {
                try {
                    const vercel = new VercelClient();
                    this.vercelProjects = await vercel.listProjects();

                    if (this.projectInfo) {
                        const match = await vercel.findProjectByNameOrRepo(
                            this.projectInfo.name,
                            this.projectInfo.repoUrl
                        );
                        this.projectExistsOnVercel = match !== null;
                    }
                } catch {
                    // Failed to fetch — keep empty list
                }
            }

            if (this.coolifyConnected) {
                try {
                    const coolify = new CoolifyClient();
                    this.coolifyApps = await coolify.listApplications();

                    if (this.projectInfo) {
                        const match = await coolify.findApplicationByNameOrRepo(
                            this.projectInfo.name,
                            this.projectInfo.repoUrl
                        );
                        this.projectExistsOnCoolify = match !== null;
                    }
                } catch {
                    // Failed to fetch — keep empty list
                }
            }

            if (this.netlifyConnected) {
                try {
                    const netlify = new NetlifyClient();
                    this.netlifySites = await netlify.listSites();

                    if (this.projectInfo) {
                        const match = await netlify.findSiteByNameOrRepo(
                            this.projectInfo.name,
                            this.projectInfo.repoUrl
                        );
                        this.projectExistsOnNetlify = match !== null;
                    }
                } catch {
                    // Failed to fetch - keep empty list
                }
            }
        } catch {
            // Error during refresh
        }

        this.isLoading = false;
        this._onDidChangeTreeData.fire();
    }

    /** Whether the current project exists on any provider. */
    get projectExistsRemotely(): boolean {
        return this.projectExistsOnVercel || this.projectExistsOnCoolify || this.projectExistsOnNetlify;
    }

    /** Get the detected project info. */
    getProjectInfo(): ProjectInfo | null {
        return this.projectInfo;
    }

    getTreeItem(element: DashboardItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: DashboardItem): Promise<DashboardItem[]> {
        if (this.isLoading) {
            return [
                new DashboardItem('Loading...', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }

        if (!element) {
            // Root level
            return this.getRootItems();
        }

        // Children of each section
        switch (element.label) {
            case '📦 Current Project':
                return this.getProjectItems();
            case '🔗 Providers':
                return this.getProviderItems();
            case '▲ Vercel Projects':
                return this.getVercelProjectItems();
            case '🧊 Coolify Applications':
                return this.getCoolifyAppItems();
            case '◼ Netlify Sites':
                return this.getNetlifySiteItems();
            case '⚡ Actions':
                return this.getActionItems();
            default:
                return [];
        }
    }

    private getRootItems(): DashboardItem[] {
        const items: DashboardItem[] = [
            new DashboardItem('📦 Current Project', 'header', vscode.TreeItemCollapsibleState.Expanded),
            new DashboardItem('🔗 Providers', 'header', vscode.TreeItemCollapsibleState.Expanded),
        ];

        if (this.vercelConnected) {
            items.push(
                new DashboardItem('▲ Vercel Projects', 'header', vscode.TreeItemCollapsibleState.Collapsed)
            );
        }

        if (this.coolifyConnected) {
            items.push(
                new DashboardItem('🧊 Coolify Applications', 'header', vscode.TreeItemCollapsibleState.Collapsed)
            );
        }

        if (this.netlifyConnected) {
            items.push(
                new DashboardItem('◼ Netlify Sites', 'header', vscode.TreeItemCollapsibleState.Collapsed)
            );
        }

        items.push(
            new DashboardItem('⚡ Actions', 'header', vscode.TreeItemCollapsibleState.Expanded)
        );

        return items;
    }

    private getProjectItems(): DashboardItem[] {
        if (!this.projectInfo) {
            return [
                new DashboardItem('No workspace open', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }

        const items: DashboardItem[] = [];
        const info = this.projectInfo;

        const nameItem = new DashboardItem(
            `Name: ${info.name}`,
            'projectInfo',
            vscode.TreeItemCollapsibleState.None
        );
        items.push(nameItem);

        if (info.repoUrl) {
            const repoItem = new DashboardItem(
                `Repo: ${info.repoOwner}/${info.repoName}`,
                'projectInfo',
                vscode.TreeItemCollapsibleState.None
            );
            items.push(repoItem);
        }

        const branchItem = new DashboardItem(
            `Branch: ${info.branch}`,
            'projectInfo',
            vscode.TreeItemCollapsibleState.None
        );
        items.push(branchItem);

        // Deployment status
        const existsRemotely = this.projectExistsOnVercel || this.projectExistsOnCoolify || this.projectExistsOnNetlify;
        const providers: string[] = [];
        if (this.projectExistsOnVercel) { providers.push('Vercel'); }
        if (this.projectExistsOnCoolify) { providers.push('Coolify'); }
        if (this.projectExistsOnNetlify) { providers.push('Netlify'); }

        const statusText = existsRemotely
            ? `Status: Deployed (${providers.join(', ')})`
            : 'Status: Not Deployed';
        const statusItem = new DashboardItem(
            statusText,
            'projectInfo',
            vscode.TreeItemCollapsibleState.None
        );
        statusItem.iconPath = new vscode.ThemeIcon(
            existsRemotely ? 'check' : 'circle-slash'
        );
        items.push(statusItem);

        return items;
    }

    private getProviderItems(): DashboardItem[] {
        const items: DashboardItem[] = [];

        const vercelItem = new DashboardItem(
            this.vercelConnected ? 'Vercel ✅ Connected' : 'Vercel ❌ Not Connected',
            this.vercelConnected ? 'providerStatus' : 'connectAction',
            vscode.TreeItemCollapsibleState.None
        );
        if (!this.vercelConnected) {
            vercelItem.command = {
                command: 'deploymentManager.connectVercel',
                title: 'Connect Vercel',
            };
        }
        items.push(vercelItem);

        const coolifyItem = new DashboardItem(
            this.coolifyConnected ? 'Coolify ✅ Connected' : 'Coolify ❌ Not Connected',
            this.coolifyConnected ? 'providerStatus' : 'connectAction',
            vscode.TreeItemCollapsibleState.None
        );
        if (!this.coolifyConnected) {
            coolifyItem.command = {
                command: 'deploymentManager.connectCoolify',
                title: 'Connect Coolify',
            };
        }
        items.push(coolifyItem);

        const netlifyItem = new DashboardItem(
            this.netlifyConnected ? 'Netlify ✅ Connected' : 'Netlify ❌ Not Connected',
            this.netlifyConnected ? 'providerStatus' : 'connectAction',
            vscode.TreeItemCollapsibleState.None
        );
        if (!this.netlifyConnected) {
            netlifyItem.command = {
                command: 'deploymentManager.connectNetlify',
                title: 'Connect Netlify',
            };
        }
        items.push(netlifyItem);

        return items;
    }

    private getVercelProjectItems(): DashboardItem[] {
        if (this.vercelProjects.length === 0) {
            return [
                new DashboardItem('No projects found', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }

        return this.vercelProjects.map((p) => {
            const item = new DashboardItem(
                p.name,
                'vercelProject',
                vscode.TreeItemCollapsibleState.None,
                { provider: 'Vercel', projectId: p.id, projectName: p.name }
            );
            item.description = p.framework || '';
            item.tooltip = `Vercel project: ${p.name}\nID: ${p.id}\nFramework: ${p.framework || 'N/A'}`;
            return item;
        });
    }

    private getCoolifyAppItems(): DashboardItem[] {
        if (this.coolifyApps.length === 0) {
            return [
                new DashboardItem('No applications found', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }

        return this.coolifyApps.map((a) => {
            const item = new DashboardItem(
                a.name,
                'coolifyApp',
                vscode.TreeItemCollapsibleState.None,
                { provider: 'Coolify', projectId: a.uuid, projectName: a.name }
            );
            item.description = a.status || '';
            item.tooltip = `Coolify app: ${a.name}\nUUID: ${a.uuid}\nStatus: ${a.status}\nDomain: ${a.fqdn || 'N/A'}`;
            return item;
        });
    }

    private getNetlifySiteItems(): DashboardItem[] {
        if (this.netlifySites.length === 0) {
            return [
                new DashboardItem('No sites found', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }

        return this.netlifySites.map((site) => {
            const item = new DashboardItem(
                site.name,
                'netlifySite',
                vscode.TreeItemCollapsibleState.None,
                { provider: 'Netlify', projectId: site.id, projectName: site.name }
            );
            item.description = site.state || '';
            item.tooltip = `Netlify site: ${site.name}\nID: ${site.id}\nState: ${site.state || 'N/A'}\nURL: ${site.ssl_url || site.url || 'N/A'}`;
            return item;
        });
    }

    private getActionItems(): DashboardItem[] {
        const items: DashboardItem[] = [];

        if (!this.vercelConnected && !this.coolifyConnected && !this.netlifyConnected) {
            items.push(
                new DashboardItem(
                    'Connect a provider to get started',
                    'noItems',
                    vscode.TreeItemCollapsibleState.None
                )
            );
            return items;
        }

        const existsRemotely = this.projectExistsOnVercel || this.projectExistsOnCoolify || this.projectExistsOnNetlify;

        if (!existsRemotely) {
            items.push(
                new DashboardItem(
                    '🚀 Deploy Project',
                    'deployAction',
                    vscode.TreeItemCollapsibleState.None
                )
            );
        }

        if (existsRemotely) {
            items.push(
                new DashboardItem(
                    '🔄 Redeploy Project',
                    'redeployAction',
                    vscode.TreeItemCollapsibleState.None
                )
            );
        }

        return items;
    }
}
