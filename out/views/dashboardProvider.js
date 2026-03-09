"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardProvider = exports.DashboardItem = void 0;
const vscode = __importStar(require("vscode"));
const vercelClient_1 = require("../clients/vercelClient");
const coolifyClient_1 = require("../clients/coolifyClient");
const netlifyClient_1 = require("../clients/netlifyClient");
const projectDetector_1 = require("../services/projectDetector");
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
/**
 * A single item in the deployment dashboard tree.
 */
class DashboardItem extends vscode.TreeItem {
    constructor(label, itemType, collapsibleState, meta) {
        super(label, collapsibleState);
        this.label = label;
        this.itemType = itemType;
        this.collapsibleState = collapsibleState;
        this.meta = meta;
        this.contextValue = itemType;
        this.setupAppearance();
    }
    setupAppearance() {
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
exports.DashboardItem = DashboardItem;
/**
 * TreeDataProvider for the Deployment Manager sidebar dashboard.
 * Displays project info, provider status, project lists, and actions.
 */
class DashboardProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.projectInfo = null;
        this.vercelConnected = false;
        this.coolifyConnected = false;
        this.netlifyConnected = false;
        this.vercelProjects = [];
        this.coolifyApps = [];
        this.netlifySites = [];
        this.projectExistsOnVercel = false;
        this.projectExistsOnCoolify = false;
        this.projectExistsOnNetlify = false;
        this.isLoading = false;
    }
    /** Refresh the tree view data. */
    async refresh() {
        this.isLoading = true;
        this._onDidChangeTreeData.fire();
        try {
            // Detect project
            const detector = new projectDetector_1.ProjectDetector();
            this.projectInfo = await detector.detect();
            // Check provider connections
            const storage = secretStorage_1.SecretStorageManager.getInstance();
            this.vercelConnected = await storage.has(types_1.StorageKeys.VERCEL_TOKEN);
            this.coolifyConnected = await storage.has(types_1.StorageKeys.COOLIFY_TOKEN);
            this.netlifyConnected = await storage.has(types_1.StorageKeys.NETLIFY_TOKEN);
            // Fetch projects from connected providers
            this.vercelProjects = [];
            this.coolifyApps = [];
            this.netlifySites = [];
            this.projectExistsOnVercel = false;
            this.projectExistsOnCoolify = false;
            this.projectExistsOnNetlify = false;
            if (this.vercelConnected) {
                try {
                    const vercel = new vercelClient_1.VercelClient();
                    this.vercelProjects = await vercel.listProjects();
                    if (this.projectInfo) {
                        const match = await vercel.findProjectByNameOrRepo(this.projectInfo.name, this.projectInfo.repoUrl);
                        if (match) {
                            this.projectExistsOnVercel = await this.isVercelProjectDeployed(vercel, match.id);
                        }
                    }
                }
                catch {
                    // Failed to fetch — keep empty list
                }
            }
            if (this.coolifyConnected) {
                try {
                    const coolify = new coolifyClient_1.CoolifyClient();
                    this.coolifyApps = await coolify.listApplications();
                    if (this.projectInfo) {
                        const match = await coolify.findApplicationByNameOrRepo(this.projectInfo.name, this.projectInfo.repoUrl);
                        this.projectExistsOnCoolify = match !== null;
                    }
                }
                catch {
                    // Failed to fetch — keep empty list
                }
            }
            if (this.netlifyConnected) {
                try {
                    const netlify = new netlifyClient_1.NetlifyClient();
                    this.netlifySites = await netlify.listSites();
                    if (this.projectInfo) {
                        const match = await netlify.findSiteByNameOrRepo(this.projectInfo.name, this.projectInfo.repoUrl);
                        this.projectExistsOnNetlify = match !== null;
                    }
                }
                catch {
                    // Failed to fetch - keep empty list
                }
            }
        }
        catch {
            // Error during refresh
        }
        this.isLoading = false;
        this._onDidChangeTreeData.fire();
    }
    /** Whether the current project exists on any provider. */
    get projectExistsRemotely() {
        return this.projectExistsOnVercel || this.projectExistsOnCoolify || this.projectExistsOnNetlify;
    }
    /** Get the detected project info. */
    getProjectInfo() {
        return this.projectInfo;
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
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
            case 'Current Project':
                return this.getProjectItems();
            case 'Providers':
                return this.getProviderItems();
            case 'Vercel Projects':
                return this.getVercelProjectItems();
            case 'Netlify Sites':
                return this.getNetlifySiteItems();
            case 'Coolify Apps (Self-Host)':
                return this.getCoolifyAppItems();
            case 'General Actions':
                return this.getActionItems();
            default:
                return [];
        }
    }
    getRootItems() {
        const items = [
            new DashboardItem('Current Project', 'header', vscode.TreeItemCollapsibleState.Expanded),
            new DashboardItem('Providers', 'header', vscode.TreeItemCollapsibleState.Expanded),
        ];
        if (this.vercelConnected) {
            items.push(new DashboardItem('Vercel Projects', 'header', vscode.TreeItemCollapsibleState.Collapsed));
        }
        if (this.netlifyConnected) {
            items.push(new DashboardItem('Netlify Sites', 'header', vscode.TreeItemCollapsibleState.Collapsed));
        }
        if (this.coolifyConnected) {
            items.push(new DashboardItem('Coolify Apps (Self-Host)', 'header', vscode.TreeItemCollapsibleState.Collapsed));
        }
        items.push(new DashboardItem('General Actions', 'header', vscode.TreeItemCollapsibleState.Expanded));
        return items;
    }
    getProjectItems() {
        if (!this.projectInfo) {
            return [
                new DashboardItem('No workspace open', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }
        const items = [];
        const info = this.projectInfo;
        const nameItem = new DashboardItem(`Name: ${info.name}`, 'projectInfo', vscode.TreeItemCollapsibleState.None);
        items.push(nameItem);
        if (info.repoUrl) {
            const repoItem = new DashboardItem(`Repo: ${info.repoOwner}/${info.repoName}`, 'projectInfo', vscode.TreeItemCollapsibleState.None);
            items.push(repoItem);
        }
        const branchItem = new DashboardItem(`Branch: ${info.branch}`, 'projectInfo', vscode.TreeItemCollapsibleState.None);
        items.push(branchItem);
        // Deployment status
        const existsRemotely = this.projectExistsOnVercel || this.projectExistsOnCoolify || this.projectExistsOnNetlify;
        const providers = [];
        if (this.projectExistsOnVercel) {
            providers.push('Vercel');
        }
        if (this.projectExistsOnCoolify) {
            providers.push('Coolify');
        }
        if (this.projectExistsOnNetlify) {
            providers.push('Netlify');
        }
        const statusText = existsRemotely
            ? `Status: Deployed in ${providers.join(', ')}`
            : 'Status: Not Deployed';
        const statusItem = new DashboardItem(statusText, 'projectInfo', vscode.TreeItemCollapsibleState.None);
        statusItem.iconPath = new vscode.ThemeIcon(existsRemotely ? 'check' : 'circle-slash');
        items.push(statusItem);
        return items;
    }
    getProviderItems() {
        const items = [];
        const vercelItem = new DashboardItem(this.vercelConnected ? 'Vercel Connected' : 'Vercel Not Connected', this.vercelConnected ? 'providerStatus' : 'connectAction', vscode.TreeItemCollapsibleState.None);
        if (!this.vercelConnected) {
            vercelItem.command = {
                command: 'deploymentManager.connectVercel',
                title: 'Connect Vercel',
            };
        }
        items.push(vercelItem);
        const coolifyItem = new DashboardItem(this.coolifyConnected ? 'Coolify Connected' : 'Coolify Not Connected', this.coolifyConnected ? 'providerStatus' : 'connectAction', vscode.TreeItemCollapsibleState.None);
        if (!this.coolifyConnected) {
            coolifyItem.command = {
                command: 'deploymentManager.connectCoolify',
                title: 'Connect Coolify',
            };
        }
        items.push(coolifyItem);
        const netlifyItem = new DashboardItem(this.netlifyConnected ? 'Netlify Connected' : 'Netlify Not Connected', this.netlifyConnected ? 'providerStatus' : 'connectAction', vscode.TreeItemCollapsibleState.None);
        if (!this.netlifyConnected) {
            netlifyItem.command = {
                command: 'deploymentManager.connectNetlify',
                title: 'Connect Netlify',
            };
        }
        items.push(netlifyItem);
        return items;
    }
    getVercelProjectItems() {
        if (this.vercelProjects.length === 0) {
            return [
                new DashboardItem('No projects found', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }
        return this.vercelProjects.map((p) => {
            const item = new DashboardItem(p.name, 'vercelProject', vscode.TreeItemCollapsibleState.None, { provider: 'Vercel', projectId: p.id, projectName: p.name });
            item.description = p.framework || '';
            item.tooltip = `Vercel project: ${p.name}\nID: ${p.id}\nFramework: ${p.framework || 'N/A'}`;
            return item;
        });
    }
    getCoolifyAppItems() {
        if (this.coolifyApps.length === 0) {
            return [
                new DashboardItem('No applications found', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }
        return this.coolifyApps.map((a) => {
            const item = new DashboardItem(a.name, 'coolifyApp', vscode.TreeItemCollapsibleState.None, { provider: 'Coolify', projectId: a.uuid, projectName: a.name });
            item.description = a.status || '';
            item.tooltip = `Coolify app: ${a.name}\nUUID: ${a.uuid}\nStatus: ${a.status}\nDomain: ${a.fqdn || 'N/A'}`;
            return item;
        });
    }
    getNetlifySiteItems() {
        if (this.netlifySites.length === 0) {
            return [
                new DashboardItem('No sites found', 'noItems', vscode.TreeItemCollapsibleState.None),
            ];
        }
        return this.netlifySites.map((site) => {
            const item = new DashboardItem(site.name, 'netlifySite', vscode.TreeItemCollapsibleState.None, { provider: 'Netlify', projectId: site.id, projectName: site.name });
            item.description = site.state || '';
            item.tooltip = `Netlify site: ${site.name}\nID: ${site.id}\nState: ${site.state || 'N/A'}\nURL: ${site.ssl_url || site.url || 'N/A'}`;
            return item;
        });
    }
    getActionItems() {
        const items = [];
        if (!this.vercelConnected && !this.coolifyConnected && !this.netlifyConnected) {
            items.push(new DashboardItem('Connect a provider to get started', 'noItems', vscode.TreeItemCollapsibleState.None));
            return items;
        }
        items.push(new DashboardItem('Deploy Project', 'deployAction', vscode.TreeItemCollapsibleState.None));
        return items;
    }
    async isVercelProjectDeployed(vercel, projectId) {
        const latest = await this.getLatestVercelDeployment(vercel, projectId);
        if (!latest) {
            return false;
        }
        const state = this.getVercelState(latest);
        if (state === 'ready') {
            return true;
        }
        return this.hasVercelBuildLogs(vercel, latest);
    }
    async getLatestVercelDeployment(vercel, projectId) {
        try {
            const deployments = await vercel.listDeployments(projectId, 1);
            const latest = deployments[0] ?? null;
            if (!latest) {
                return null;
            }
            const deploymentId = latest.uid || latest.id;
            if (!deploymentId) {
                return latest;
            }
            try {
                const detailed = await vercel.getDeployment(deploymentId);
                return {
                    ...latest,
                    ...detailed,
                    uid: detailed.uid || latest.uid,
                    name: detailed.name || latest.name,
                };
            }
            catch {
                return latest;
            }
        }
        catch {
            return null;
        }
    }
    getVercelState(deployment) {
        const raw = deployment?.state ?? deployment?.readyState ?? 'unknown';
        return String(raw).toLowerCase();
    }
    async hasVercelBuildLogs(vercel, deployment) {
        if (!deployment) {
            return false;
        }
        const deploymentId = deployment.uid || deployment.id;
        if (!deploymentId) {
            return false;
        }
        try {
            const events = await vercel.getDeploymentEvents(deploymentId, { limit: 40, direction: 'backward' });
            return events.some((event) => {
                try {
                    return JSON.stringify(event).toLowerCase().includes('ready');
                }
                catch {
                    return false;
                }
            });
        }
        catch {
            return false;
        }
    }
}
exports.DashboardProvider = DashboardProvider;
//# sourceMappingURL=dashboardProvider.js.map