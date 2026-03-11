import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { promisify } from 'util';
import { CoolifyClient } from '../clients/coolifyClient';
import { GitHubClient } from '../clients/githubClient';
import { NetlifyClient } from '../clients/netlifyClient';
import { VercelClient } from '../clients/vercelClient';
import { redeployProject } from '../commands/redeployProject';
import { ProjectDetector } from '../services/projectDetector';
import { SecretStorageManager } from '../utils/secretStorage';
import {
    CoolifyApplication,
    NetlifyDeploy,
    NetlifySite,
    ProjectInfo,
    StorageKeys,
    VercelDeployment,
    VercelProject,
} from '../utils/types';

type ProviderName = 'Vercel' | 'Coolify' | 'Netlify';

interface DashboardActivityItem {
    id: string;
    provider: ProviderName;
    projectId: string;
    projectName: string;
    title: string;
    state: string;
    timestamp: number;
    timestampLabel: string;
}

interface DashboardPanelData {
    generatedAt: string;
    projectInfo: ProjectInfo | null;
    vercelConnected: boolean;
    coolifyConnected: boolean;
    netlifyConnected: boolean;
    projectExistsOnVercel: boolean;
    projectExistsOnCoolify: boolean;
    projectExistsOnNetlify: boolean;
    vercelProjects: VercelProject[];
    coolifyApps: CoolifyApplication[];
    netlifySites: NetlifySite[];
    activity: DashboardActivityItem[];
    stateCounts: Record<string, number>;
    managedResources: ManagedResourceItem[];
    latestCommitLabel: string;
}

interface DashboardWebviewMessage {
    command:
    | 'refresh'
    | 'checkGitUpdates'
    | 'refreshProviderResources'
    | 'connectVercel'
    | 'connectCoolify'
    | 'connectNetlify'
    | 'deployProject'
    | 'redeployProject'
    | 'redeployResource'
    | 'visitResourceSite'
    | 'importResourceEnv'
    | 'openLogs'
    | 'redeployResult';
    requestId?: string;
    provider?: string;
    projectId?: string;
    projectName?: string;
    resourceKey?: string;
    siteUrl?: string;
    success?: boolean;
    imported?: number;
    error?: string;
    phase?: string;
    state?: string;
    messageText?: string;
    sourceLabel?: string;
    uploaded?: number;
    total?: number;
    sectionBodyHtml?: string;
    providerSectionHtml?: string;
    latestCommitLabel?: string;
}

interface ManagedResourceItem {
    key: string;
    provider: ProviderName;
    projectId: string;
    projectName: string;
    detailLabel: string;
    statusDetailLabel?: string;
    deploymentStatus: 'ready' | 'not-ready' | 'error';
    deploymentStatusLabel: string;
    siteUrl: string | null;
}

/**
 * Rich deployment dashboard shown as a closeable editor tab.
 * Opened by clicking the rocket icon container.
 */
export class DashboardPanel {
    private static currentPanel: DashboardPanel | undefined;

    static createOrShow(extensionUri: vscode.Uri, runRefresh: () => Promise<void>): void {
        const activeColumn = vscode.window.activeTextEditor?.viewColumn;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.runRefresh = runRefresh;
            DashboardPanel.currentPanel.panel.reveal(activeColumn ?? vscode.ViewColumn.One);
            void DashboardPanel.currentPanel.render();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'deploymentManagerDashboardPanel',
            'Deployment Manager Dashboard',
            activeColumn ?? vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: false,
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, runRefresh);
    }

    static refreshCurrentPanel(): void {
        if (DashboardPanel.currentPanel) {
            void DashboardPanel.currentPanel.render();
        }
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private runRefresh: () => Promise<void>;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly execFileAsync = promisify(execFile);

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, runRefresh: () => Promise<void>) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.runRefresh = runRefresh;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            async (message: DashboardWebviewMessage) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        void this.render();
    }

    private async handleMessage(message: DashboardWebviewMessage): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.runRefresh();
                return;
            case 'checkGitUpdates':
                if (!message.requestId) {
                    return;
                }
                try {
                    const data = await this.collectData();
                    this.panel.webview.postMessage({
                        command: 'checkGitUpdatesResult',
                        requestId: message.requestId,
                        success: true,
                        sectionBodyHtml: this.getManagedResourcesBodyHtml(data),
                        latestCommitLabel: data.latestCommitLabel,
                    });
                } catch (error) {
                    const text = error instanceof Error ? error.message : String(error);
                    this.panel.webview.postMessage({
                        command: 'checkGitUpdatesResult',
                        requestId: message.requestId,
                        success: false,
                        error: text,
                    });
                }
                return;
            case 'refreshProviderResources':
                if (!message.requestId || !this.isProviderName(message.provider)) {
                    this.panel.webview.postMessage({
                        command: 'refreshProviderResourcesResult',
                        requestId: message.requestId,
                        success: false,
                        error: 'Missing provider metadata for section refresh.',
                    });
                    return;
                }
                try {
                    const data = await this.collectData();
                    this.panel.webview.postMessage({
                        command: 'refreshProviderResourcesResult',
                        requestId: message.requestId,
                        success: true,
                        providerSectionHtml: this.getManagedProviderSectionHtml(message.provider, data),
                    });
                } catch (error) {
                    const text = error instanceof Error ? error.message : String(error);
                    this.panel.webview.postMessage({
                        command: 'refreshProviderResourcesResult',
                        requestId: message.requestId,
                        success: false,
                        error: text,
                    });
                }
                return;
            case 'connectVercel':
                await vscode.commands.executeCommand('deploymentManager.connectVercel');
                return;
            case 'connectCoolify':
                await vscode.commands.executeCommand('deploymentManager.connectCoolify');
                return;
            case 'connectNetlify':
                await vscode.commands.executeCommand('deploymentManager.connectNetlify');
                return;
            case 'deployProject':
                await vscode.commands.executeCommand('deploymentManager.deployProject');
                return;
            case 'redeployProject':
                if (message.requestId) {
                    try {
                        const result = await vscode.commands.executeCommand<{ success: boolean; error?: string }>(
                            'deploymentManager.redeployProject',
                            {
                                notify: false,
                                refresh: false,
                            }
                        );
                        this.panel.webview.postMessage({
                            command: 'redeployResult',
                            requestId: message.requestId,
                            success: result?.success === true,
                            error: result?.error,
                        });
                    } catch (error) {
                        const text = error instanceof Error ? error.message : String(error);
                        this.panel.webview.postMessage({
                            command: 'redeployResult',
                            requestId: message.requestId,
                            success: false,
                            error: text,
                        });
                    }
                    return;
                }
                await vscode.commands.executeCommand('deploymentManager.redeployProject');
                return;
            case 'redeployResource': {
                if (!message.requestId || !message.provider || !message.projectId || !message.projectName) {
                    this.panel.webview.postMessage({
                        command: 'redeployResult',
                        requestId: message.requestId,
                        success: false,
                        error: 'Missing redeploy target metadata.',
                    });
                    return;
                }

                try {
                    const providerName = this.isProviderName(message.provider) ? message.provider : null;
                    if (!providerName) {
                        throw new Error('Unsupported provider for redeploy.');
                    }
                    const result = await redeployProject(this.runRefresh, {
                        target: {
                            provider: providerName,
                            id: message.projectId,
                            name: message.projectName,
                        },
                        notify: false,
                        refreshDashboard: false,
                    });

                    this.panel.webview.postMessage({
                        command: 'redeployResult',
                        requestId: message.requestId,
                        resourceKey: message.resourceKey,
                        success: result?.success === true,
                        error: result?.error,
                    });
                } catch (error) {
                    const text = error instanceof Error ? error.message : String(error);
                    this.panel.webview.postMessage({
                        command: 'redeployResult',
                        requestId: message.requestId,
                        resourceKey: message.resourceKey,
                        success: false,
                        error: text,
                    });
                }
                return;
            }
            case 'visitResourceSite': {
                if (!this.isProviderName(message.provider) || !message.projectId) {
                    vscode.window.showWarningMessage('Missing resource metadata for Visit Site.');
                    return;
                }

                const resolvedUrl = await this.resolveSiteUrl(
                    message.provider,
                    message.projectId,
                    message.siteUrl
                );

                if (!resolvedUrl) {
                    vscode.window.showWarningMessage(`No public URL found for ${message.projectName || message.projectId}.`);
                    return;
                }

                await vscode.env.openExternal(vscode.Uri.parse(resolvedUrl));
                return;
            }
            case 'importResourceEnv': {
                if (!message.requestId || !this.isProviderName(message.provider) || !message.projectId) {
                    this.panel.webview.postMessage({
                        command: 'importEnvResult',
                        requestId: message.requestId,
                        success: false,
                        error: 'Missing provider/project metadata for .env import.',
                    });
                    return;
                }

                try {
                    const result = await this.importEnvForResource(
                        message.provider,
                        message.projectId
                    );
                    this.panel.webview.postMessage({
                        command: 'importEnvResult',
                        requestId: message.requestId,
                        success: result.failed.length === 0,
                        imported: result.imported,
                        error: result.failed.length > 0
                            ? `Failed keys: ${result.failed.join(', ')}`
                            : undefined,
                    });
                } catch (error) {
                    const text = error instanceof Error ? error.message : String(error);
                    this.panel.webview.postMessage({
                        command: 'importEnvResult',
                        requestId: message.requestId,
                        success: false,
                        error: text,
                    });
                }
                return;
            }
            case 'openLogs':
                if (message.provider && message.projectId) {
                    await vscode.commands.executeCommand('deploymentManager.openLogs', {
                        meta: {
                            provider: message.provider,
                            projectId: message.projectId,
                            projectName: message.projectName,
                        },
                    });
                } else {
                    await vscode.commands.executeCommand('deploymentManager.openLogs');
                }
                return;
            default:
                return;
        }
    }

    private isProviderName(value: string | undefined): value is ProviderName {
        return value === 'Vercel' || value === 'Coolify' || value === 'Netlify';
    }

    private async resolveSiteUrl(
        provider: ProviderName,
        projectId: string,
        preferredUrl?: string
    ): Promise<string | null> {
        const normalizedPreferred = this.normalizePublicUrl(preferredUrl);
        if (normalizedPreferred) {
            return normalizedPreferred;
        }

        try {
            if (provider === 'Vercel') {
                const deployment = await this.getLatestVercelDeployment(new VercelClient(), projectId);
                return deployment?.url ? this.normalizePublicUrl(`https://${deployment.url}`) : null;
            }

            if (provider === 'Coolify') {
                const app = await new CoolifyClient().getApplication(projectId);
                return this.normalizePublicUrl(app.fqdn);
            }

            const netlify = new NetlifyClient();
            const site = await netlify.getSite(projectId);
            const latestDeploy = await this.getLatestNetlifyDeploy(netlify, projectId);
            return this.normalizePublicUrl(
                site.ssl_url ||
                site.url ||
                site.deploy_url ||
                latestDeploy?.deploy_ssl_url ||
                latestDeploy?.ssl_url ||
                latestDeploy?.deploy_url ||
                latestDeploy?.url
            );
        } catch {
            return null;
        }
    }

    private async importEnvForResource(
        provider: ProviderName,
        projectId: string
    ): Promise<{ imported: number; failed: string[] }> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            filters: {
                'Environment Files': ['env'],
                'All Files': ['*'],
            },
            openLabel: 'Import .env',
            title: 'Select .env file to import',
        });

        if (!picked || picked.length === 0) {
            throw new Error('Import canceled.');
        }

        const content = await readFile(picked[0].fsPath, 'utf8');
        const envVars = this.parseDotEnv(content);
        const count = Object.keys(envVars).length;
        if (count === 0) {
            throw new Error('No valid KEY=VALUE entries found in the selected file.');
        }

        if (provider === 'Vercel') {
            return new VercelClient().upsertProjectEnvVars(projectId, envVars);
        }

        if (provider === 'Coolify') {
            return new CoolifyClient().upsertApplicationEnvVars(projectId, envVars);
        }

        return new NetlifyClient().upsertSiteEnvVars(projectId, envVars);
    }

    private parseDotEnv(content: string): Record<string, string> {
        const parsed: Record<string, string> = {};
        const lines = content.split(/\r?\n/);

        for (const originalLine of lines) {
            const trimmed = originalLine.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const line = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
            const separator = line.indexOf('=');
            if (separator <= 0) {
                continue;
            }

            const key = line.slice(0, separator).trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                continue;
            }

            let value = line.slice(separator + 1).trim();

            const hasMatchingDoubleQuotes = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
            const hasMatchingSingleQuotes = value.startsWith('\'') && value.endsWith('\'') && value.length >= 2;

            if (hasMatchingDoubleQuotes) {
                value = value.slice(1, -1)
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\r')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');
            } else if (hasMatchingSingleQuotes) {
                value = value.slice(1, -1);
            } else {
                const inlineCommentIndex = value.indexOf(' #');
                if (inlineCommentIndex >= 0) {
                    value = value.slice(0, inlineCommentIndex).trimEnd();
                }
            }

            parsed[key] = value;
        }

        return parsed;
    }

    private async render(): Promise<void> {
        this.panel.webview.html = this.getLoadingHtml();

        try {
            const data = await this.collectData();
            this.panel.webview.html = this.getDashboardHtml(data);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.panel.webview.html = this.getErrorHtml(message);
        }
    }

    private async collectData(): Promise<DashboardPanelData> {
        const detector = new ProjectDetector();
        const projectInfo = await detector.detect();

        const storage = SecretStorageManager.getInstance();
        const vercelConnected = await storage.has(StorageKeys.VERCEL_TOKEN);
        const coolifyConnected = await storage.has(StorageKeys.COOLIFY_TOKEN);
        const netlifyConnected = await storage.has(StorageKeys.NETLIFY_TOKEN);

        let projectExistsOnVercel = false;
        let projectExistsOnCoolify = false;
        let projectExistsOnNetlify = false;

        let vercelProjects: VercelProject[] = [];
        let coolifyApps: CoolifyApplication[] = [];
        let netlifySites: NetlifySite[] = [];
        const activity: DashboardActivityItem[] = [];

        if (vercelConnected) {
            try {
                const vercel = new VercelClient();
                vercelProjects = await vercel.listProjects();

                if (projectInfo) {
                    const matched = await vercel.findProjectByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
                    if (matched) {
                        projectExistsOnVercel = await this.isVercelProjectDeployed(vercel, matched.id);
                    }

                    if (matched) {
                        const deployments = await vercel.listDeployments(matched.id, 8);
                        activity.push(...this.mapVercelDeployments(deployments, matched.name, matched.id));
                    }
                }

                if (activity.length === 0 && vercelProjects.length > 0) {
                    const sampleProjects = vercelProjects.slice(0, 3);
                    for (const project of sampleProjects) {
                        const deployments = await vercel.listDeployments(project.id, 2);
                        activity.push(...this.mapVercelDeployments(deployments, project.name, project.id));
                    }
                }
            } catch {
                // Ignore API failures and keep dashboard usable.
            }
        }

        if (coolifyConnected) {
            try {
                const coolify = new CoolifyClient();
                coolifyApps = await coolify.listApplications();

                if (projectInfo) {
                    const matched = await coolify.findApplicationByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
                    if (matched) {
                        projectExistsOnCoolify = this.isCoolifyAppDeployed(matched);
                    }
                }

                activity.push(
                    ...coolifyApps.slice(0, 12).map((app) => ({
                        id: `coolify-${app.uuid}`,
                        provider: 'Coolify' as const,
                        projectId: app.uuid,
                        projectName: app.name,
                        title: app.name,
                        state: app.status || 'Unknown',
                        timestamp: DashboardPanel.normalizeTimestamp(app.updated_at),
                        timestampLabel: DashboardPanel.formatTimestamp(app.updated_at),
                    }))
                );
            } catch {
                // Ignore API failures and keep dashboard usable.
            }
        }

        if (netlifyConnected) {
            try {
                const netlify = new NetlifyClient();
                netlifySites = await netlify.listSites();

                if (projectInfo) {
                    const matched = await netlify.findSiteByNameOrRepo(projectInfo.name, projectInfo.repoUrl);

                    if (matched) {
                        projectExistsOnNetlify = this.isNetlifySiteDeployed(matched);
                    }

                    if (matched) {
                        const deploys = await netlify.listSiteDeploys(matched.id, 8);
                        activity.push(...this.mapNetlifyDeployments(deploys, matched.name, matched.id));
                    }
                }

                if (netlifySites.length > 0) {
                    const sampleSites = netlifySites.slice(0, 3);
                    for (const site of sampleSites) {
                        const deploys = await netlify.listSiteDeploys(site.id, 2);
                        activity.push(...this.mapNetlifyDeployments(deploys, site.name, site.id));
                    }
                }
            } catch {
                // Ignore API failures and keep dashboard usable.
            }
        }

        if (projectInfo) {
            projectExistsOnCoolify = projectExistsOnCoolify || this.matchesWorkspaceOnCoolify(projectInfo, coolifyApps);
            projectExistsOnNetlify = projectExistsOnNetlify || this.matchesWorkspaceOnNetlify(projectInfo, netlifySites);
        }

        activity.sort((a, b) => b.timestamp - a.timestamp);
        const trimmedActivity = activity.slice(0, 20);

        const stateCounts = this.buildStateCounts(trimmedActivity);
        const managedResources = await this.buildManagedResources(
            vercelProjects,
            coolifyApps,
            netlifySites,
            vercelConnected,
            netlifyConnected
        );
        const latestCommitLabel = await this.getWorkspaceLatestCommitLabel(projectInfo);

        return {
            generatedAt: new Date().toLocaleString(),
            projectInfo,
            vercelConnected,
            coolifyConnected,
            netlifyConnected,
            projectExistsOnVercel,
            projectExistsOnCoolify,
            projectExistsOnNetlify,
            vercelProjects,
            coolifyApps,
            netlifySites,
            activity: trimmedActivity,
            stateCounts,
            managedResources,
            latestCommitLabel,
        };
    }

    private mapVercelDeployments(
        deployments: VercelDeployment[],
        projectName: string,
        projectId: string
    ): DashboardActivityItem[] {
        return deployments.map((deployment) => {
            const timestamp = DashboardPanel.normalizeTimestamp(deployment.createdAt ?? deployment.created);
            return {
                id: `vercel-${deployment.uid}`,
                provider: 'Vercel',
                projectId,
                projectName,
                title: deployment.uid.substring(0, 10),
                state: this.getVercelState(deployment),
                timestamp,
                timestampLabel: DashboardPanel.formatTimestamp(timestamp),
            };
        });
    }

    private mapNetlifyDeployments(
        deploys: NetlifyDeploy[],
        projectName: string,
        projectId: string
    ): DashboardActivityItem[] {
        return deploys.map((deploy) => {
            const timestamp = DashboardPanel.normalizeTimestamp(
                deploy.published_at || deploy.updated_at || deploy.created_at
            );
            return {
                id: `netlify-${deploy.id}`,
                provider: 'Netlify',
                projectId,
                projectName,
                title: deploy.id.substring(0, 10),
                state: deploy.state || 'Unknown',
                timestamp,
                timestampLabel: DashboardPanel.formatTimestamp(timestamp),
            };
        });
    }

    private buildStateCounts(activity: DashboardActivityItem[]): Record<string, number> {
        const counts: Record<string, number> = {};

        for (const item of activity) {
            const normalizedState = this.normalizeState(item.state);
            counts[normalizedState] = (counts[normalizedState] ?? 0) + 1;
        }

        if (Object.keys(counts).length === 0) {
            counts['No Data'] = 1;
        }

        return counts;
    }

    private normalizeState(state: string): string {
        const value = state.toLowerCase();

        if (value.includes('ready') || value.includes('running') || value.includes('success')) {
            return 'Ready';
        }

        if (
            value.includes('build') ||
            value.includes('queue') ||
            value.includes('init') ||
            value.includes('starting')
        ) {
            return 'Building';
        }

        if (value.includes('error') || value.includes('fail') || value.includes('crash')) {
            return 'Error';
        }

        if (value.includes('cancel') || value.includes('stop')) {
            return 'Canceled';
        }

        return 'Other';
    }

    private async buildManagedResources(
        vercelProjects: VercelProject[],
        coolifyApps: CoolifyApplication[],
        netlifySites: NetlifySite[],
        vercelConnected: boolean,
        netlifyConnected: boolean
    ): Promise<ManagedResourceItem[]> {
        const resources: ManagedResourceItem[] = [];
        const vercel = vercelConnected ? new VercelClient() : null;
        const netlify = netlifyConnected ? new NetlifyClient() : null;

        const vercelLimit = vercelProjects.slice(0, 10);
        for (const project of vercelLimit) {
            const latestDeployment = await this.getLatestVercelDeployment(vercel, project.id);
            const rawState = this.getVercelState(latestDeployment);
            const hasLogs = await this.hasVercelBuildLogs(vercel, latestDeployment);
            const effectiveState = rawState === 'ready' || hasLogs ? 'ready' : rawState;
            const status = this.toManagedStatus('Vercel', effectiveState);
            const siteUrl = latestDeployment?.url
                ? this.normalizePublicUrl(`https://${latestDeployment.url}`)
                : null;
            const statusDetailLabel = this.buildVercelStatusDetail(latestDeployment, hasLogs);

            resources.push({
                key: `vercel-${project.id}`,
                provider: 'Vercel',
                projectId: project.id,
                projectName: project.name,
                detailLabel: project.framework ?? 'framework n/a',
                statusDetailLabel,
                deploymentStatus: status,
                deploymentStatusLabel: this.toManagedStatusLabel('Vercel', effectiveState, status),
                siteUrl,
            });
        }

        const coolifyLimit = coolifyApps.slice(0, 10);
        for (const app of coolifyLimit) {
            const rawState = app.status || 'unknown';
            const status = this.toManagedStatus('Coolify', rawState);
            const siteUrl = this.normalizePublicUrl(app.fqdn);
            const statusDetailLabel = app.updated_at
                ? `Updated ${DashboardPanel.formatRelativeTime(app.updated_at)}`
                : undefined;

            resources.push({
                key: `coolify-${app.uuid}`,
                provider: 'Coolify',
                projectId: app.uuid,
                projectName: app.name,
                detailLabel: app.status || 'status n/a',
                statusDetailLabel,
                deploymentStatus: status,
                deploymentStatusLabel: this.toManagedStatusLabel('Coolify', rawState, status),
                siteUrl,
            });
        }

        const netlifyLimit = netlifySites.slice(0, 10);
        for (const site of netlifyLimit) {
            const latestDeploy = await this.getLatestNetlifyDeploy(netlify, site.id);
            const rawState = latestDeploy?.state || site.state || 'unknown';
            const status = this.toManagedStatus('Netlify', rawState);
            const siteUrl = this.normalizePublicUrl(
                site.ssl_url ||
                site.url ||
                site.deploy_url ||
                latestDeploy?.deploy_ssl_url ||
                latestDeploy?.ssl_url ||
                latestDeploy?.deploy_url ||
                latestDeploy?.url
            );
            const netlifyTimestamp = latestDeploy?.updated_at || latestDeploy?.published_at || latestDeploy?.created_at;
            const statusDetailLabel = netlifyTimestamp
                ? `Updated ${DashboardPanel.formatRelativeTime(netlifyTimestamp)}`
                : undefined;

            resources.push({
                key: `netlify-${site.id}`,
                provider: 'Netlify',
                projectId: site.id,
                projectName: site.name,
                detailLabel: rawState || 'state n/a',
                statusDetailLabel,
                deploymentStatus: status,
                deploymentStatusLabel: this.toManagedStatusLabel('Netlify', rawState, status),
                siteUrl,
            });
        }

        return resources;
    }

    private toManagedStatus(provider: ProviderName, rawState: string): ManagedResourceItem['deploymentStatus'] {
        const value = rawState.toLowerCase();

        if (provider === 'Vercel') {
            if (value === 'ready') {
                return 'ready';
            }
            if (value === 'error' || value === 'canceled') {
                return 'error';
            }
            return 'not-ready';
        }

        if (provider === 'Coolify') {
            if (['running', 'ready', 'healthy', 'active', 'started', 'up'].includes(value)) {
                return 'ready';
            }
            if (['failed', 'error', 'errored', 'crashed', 'dead', 'unhealthy', 'stopped', 'exited'].includes(value)) {
                return 'error';
            }
            return 'not-ready';
        }

        if (['ready', 'processed'].includes(value)) {
            return 'ready';
        }
        if (['error', 'rejected'].includes(value)) {
            return 'error';
        }
        return 'not-ready';
    }

    private toManagedStatusLabel(
        provider: ProviderName,
        rawState: string,
        status: ManagedResourceItem['deploymentStatus']
    ): string {
        const value = rawState.toLowerCase();

        if (provider === 'Vercel') {
            if (value === 'ready') {
                return 'Ready';
            }
            if (value === 'queued') {
                return 'Queued';
            }
            if (value === 'initializing') {
                return 'Uploading';
            }
            if (value === 'building') {
                return 'Deploying';
            }
            if (value === 'error') {
                return 'Failed';
            }
            if (value === 'canceled') {
                return 'Canceled';
            }
            return 'Processing';
        }

        if (status === 'ready') {
            return 'Ready';
        }

        if (status === 'error') {
            return 'Failed';
        }

        return DashboardPanel.toTitleCase(rawState || 'not ready');
    }

    private getVercelState(deployment: VercelDeployment | null): string {
        const raw = deployment?.state ?? deployment?.readyState ?? 'unknown';
        return String(raw).toLowerCase();
    }

    private buildVercelStatusDetail(
        deployment: VercelDeployment | null,
        hasLogs: boolean = false
    ): string | undefined {
        if (!deployment) {
            return undefined;
        }

        const parts: string[] = [];
        const updatedAt = deployment.ready ?? deployment.createdAt ?? deployment.created;
        if (typeof updatedAt === 'number' && updatedAt > 0) {
            parts.push(`Updated ${DashboardPanel.formatRelativeTime(updatedAt)}`);
        }

        const source = this.extractVercelSource(deployment);
        if (source) {
            parts.push(`From ${source}`);
        }

        if (hasLogs && this.getVercelState(deployment) !== 'ready') {
            parts.push('Logs available');
        }

        return parts.length > 0 ? parts.join(' • ') : undefined;
    }

    private async hasVercelBuildLogs(
        vercel: VercelClient | null,
        deployment: VercelDeployment | null
    ): Promise<boolean> {
        if (!vercel || !deployment) {
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
                } catch {
                    return false;
                }
            });
        } catch {
            return false;
        }
    }

    private async isVercelProjectDeployed(vercel: VercelClient | null, projectId: string): Promise<boolean> {
        const latest = await this.getLatestVercelDeployment(vercel, projectId);
        if (!latest) {
            return false;
        }

        if (this.normalizePublicUrl(latest.url ? `https://${latest.url}` : null)) {
            return true;
        }

        return this.hasVercelBuildLogs(vercel, latest);
    }

    private extractVercelSource(deployment: VercelDeployment): string | null {
        const creator = deployment.creator;
        const meta = deployment.meta ?? {};
        const candidates: Array<string | undefined> = [
            creator?.githubLogin,
            creator?.username,
            meta.githubCommitAuthorLogin,
            meta.githubCommitAuthorName,
            creator?.email,
        ];

        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }

        return null;
    }

    private normalizePublicUrl(value: string | null | undefined): string | null {
        if (!value) {
            return null;
        }

        const first = value.split(',')[0]?.trim();
        if (!first) {
            return null;
        }

        if (/^https?:\/\//i.test(first)) {
            return first;
        }

        if (first.startsWith('//')) {
            return `https:${first}`;
        }

        return `https://${first}`;
    }

    private matchesWorkspaceOnVercel(projectInfo: ProjectInfo, projects: VercelProject[]): boolean {
        const workspaceName = projectInfo.name.trim().toLowerCase();
        const workspaceRepo = this.normalizeRepoIdentifier(projectInfo.repoUrl);

        return projects.some((project) => {
            const sameName = project.name.trim().toLowerCase() === workspaceName;
            const projectRepo = this.normalizeRepoIdentifier(project.link?.repo);
            const sameRepo = !!workspaceRepo && !!projectRepo && workspaceRepo === projectRepo;
            return sameName || sameRepo;
        });
    }

    private matchesWorkspaceOnCoolify(projectInfo: ProjectInfo, apps: CoolifyApplication[]): boolean {
        const workspaceName = projectInfo.name.trim().toLowerCase();
        const workspaceRepo = this.normalizeRepoIdentifier(projectInfo.repoUrl);

        return apps.some((app) => {
            const sameName = app.name.trim().toLowerCase() === workspaceName;
            const appRepo = this.normalizeRepoIdentifier(app.git_repository);
            const sameRepo = !!workspaceRepo && !!appRepo && workspaceRepo === appRepo;
            return (sameName || sameRepo) && this.isCoolifyAppDeployed(app);
        });
    }

    private matchesWorkspaceOnNetlify(projectInfo: ProjectInfo, sites: NetlifySite[]): boolean {
        const workspaceName = projectInfo.name.trim().toLowerCase();
        const workspaceRepo = this.normalizeRepoIdentifier(projectInfo.repoUrl);

        return sites.some((site) => {
            const sameName = site.name.trim().toLowerCase() === workspaceName;
            const repoCandidates = [
                site.repo?.repo_url,
                site.build_settings?.repo_url,
                site.repo?.repo_path,
                site.build_settings?.repo_path,
            ];
            const sameRepo = repoCandidates.some((candidate) => {
                const normalized = this.normalizeRepoIdentifier(candidate);
                return !!workspaceRepo && !!normalized && workspaceRepo === normalized;
            });
            return (sameName || sameRepo) && this.isNetlifySiteDeployed(site);
        });
    }

    private isCoolifyAppDeployed(app: CoolifyApplication | null): boolean {
        return !!this.normalizePublicUrl(app?.fqdn);
    }

    private isNetlifySiteDeployed(site: NetlifySite | null): boolean {
        if (!site) {
            return false;
        }

        const candidate =
            site.ssl_url ||
            site.url ||
            site.deploy_url ||
            site.published_deploy?.deploy_ssl_url ||
            site.published_deploy?.ssl_url ||
            site.published_deploy?.deploy_url ||
            site.published_deploy?.url;

        return !!this.normalizePublicUrl(candidate);
    }

    private normalizeRepoIdentifier(value: string | null | undefined): string | null {
        if (!value || !value.trim()) {
            return null;
        }

        return value
            .trim()
            .replace(/^https?:\/\//i, '')
            .replace(/^git@github\.com:/i, 'github.com/')
            .replace(/\.git$/i, '')
            .toLowerCase();
    }

    private async getLatestVercelDeployment(
        vercel: VercelClient | null,
        projectId: string
    ): Promise<VercelDeployment | null> {
        if (!vercel) {
            return null;
        }

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
            } catch {
                return latest;
            }
        } catch {
            return null;
        }
    }

    private async getLatestNetlifyDeploy(
        netlify: NetlifyClient | null,
        siteId: string
    ): Promise<NetlifyDeploy | null> {
        if (!netlify) {
            return null;
        }

        try {
            const deploys = await netlify.listSiteDeploys(siteId, 1);
            return deploys[0] ?? null;
        } catch {
            return null;
        }
    }

    private async getWorkspaceLatestCommitLabel(projectInfo: ProjectInfo | null): Promise<string> {
        const fromLocalGit = await this.getLatestCommitFromLocalGit(projectInfo);
        if (fromLocalGit) {
            return fromLocalGit;
        }

        if (!projectInfo?.repoOwner || !projectInfo.repoName) {
            return 'Not available';
        }

        const github = new GitHubClient();
        const commit = await github.getLatestCommit(projectInfo.repoOwner, projectInfo.repoName, projectInfo.branch);
        if (!commit) {
            return 'Not available';
        }

        const message = commit.commit.message.split('\n')[0].trim() || 'No commit message';
        const shortSha = commit.sha.slice(0, 7);
        const maxMessageLength = 72;
        const clippedMessage = message.length > maxMessageLength
            ? `${message.slice(0, maxMessageLength - 3)}...`
            : message;

        return `${clippedMessage} (${shortSha})`;
    }

    private async getLatestCommitFromLocalGit(projectInfo: ProjectInfo | null): Promise<string | null> {
        if (!projectInfo?.folderPath) {
            return null;
        }

        try {
            const { stdout } = await this.execFileAsync(
                'git',
                ['-C', projectInfo.folderPath, 'log', '-1', '--pretty=%s (%h)'],
                { windowsHide: true }
            );
            const line = stdout.trim();
            return line.length > 0 ? line : null;
        } catch {
            return null;
        }
    }

    private getManagedResourceRowHtml(item: ManagedResourceItem, index: number): string {
        const stateClass =
            item.deploymentStatus === 'ready'
                ? 'git-pill-ok'
                : item.deploymentStatus === 'error'
                    ? 'git-pill-error'
                    : 'git-pill-warning';

        const visitAttrs = item.siteUrl
            ? `data-site-url="${DashboardPanel.escapeHtml(item.siteUrl)}"`
            : 'disabled';

        return `
            <li class="resource-item">
                <div class="resource-meta">
                    <strong class="resource-title">${DashboardPanel.escapeHtml(item.projectName)}</strong>
                    <small class="resource-subtitle">${DashboardPanel.escapeHtml(item.detailLabel)}</small>
                    ${item.statusDetailLabel
                ? `<small id="resource-status-detail-${DashboardPanel.escapeHtml(item.key)}" class="resource-subtitle">${DashboardPanel.escapeHtml(item.statusDetailLabel)}</small>`
                : `<small id="resource-status-detail-${DashboardPanel.escapeHtml(item.key)}" class="resource-subtitle"></small>`}
                    <span class="git-pill ${stateClass}" id="resource-pill-${DashboardPanel.escapeHtml(item.key)}">${DashboardPanel.escapeHtml(item.deploymentStatusLabel)}</span>
                </div>
                <div class="resource-actions">
                    <button
                        class="ghost-btn resource-btn"
                        data-action="visit-site"
                        data-provider="${DashboardPanel.escapeHtml(item.provider)}"
                        data-project-id="${DashboardPanel.escapeHtml(item.projectId)}"
                        data-project-name="${DashboardPanel.escapeHtml(item.projectName)}"
                        ${visitAttrs}
                        type="button"
                    >Visit Site</button>
                    <button
                        class="ghost-btn resource-btn"
                        data-action="import-env"
                        data-provider="${DashboardPanel.escapeHtml(item.provider)}"
                        data-project-id="${DashboardPanel.escapeHtml(item.projectId)}"
                        data-project-name="${DashboardPanel.escapeHtml(item.projectName)}"
                        data-resource-key="${DashboardPanel.escapeHtml(item.key)}"
                        type="button"
                    >Import .env</button>
                    <button
                        class="ghost-btn redeploy-resource-btn resource-btn"
                        data-action="redeploy-resource"
                        data-provider="${DashboardPanel.escapeHtml(item.provider)}"
                        data-project-id="${DashboardPanel.escapeHtml(item.projectId)}"
                        data-project-name="${DashboardPanel.escapeHtml(item.projectName)}"
                        data-resource-key="${DashboardPanel.escapeHtml(item.key)}"
                        type="button"
                    >Redeploy</button>
                    <small id="redeploy-status-${DashboardPanel.escapeHtml(item.key)}" class="redeploy-status"></small>
                    <small id="import-status-${DashboardPanel.escapeHtml(item.key)}" class="redeploy-status"></small>
                </div>
            </li>
        `;
    }

    private getManagedResourcesBodyHtml(data: DashboardPanelData): string {
        return `
            <div class="resource-grid">
                ${this.getManagedProviderSectionHtml('Vercel', data)}
                ${this.getManagedProviderSectionHtml('Netlify', data)}
                ${this.getManagedProviderSectionHtml('Coolify', data)}
            </div>
            <section id="redeploy-log-shell" class="redeploy-log-shell" aria-label="Deploy log">
                <div id="redeploy-log-title" class="redeploy-log-title">Deploy log</div>
                <pre id="redeploy-log-view" class="redeploy-log-view" aria-live="polite"></pre>
            </section>
            <div class="footer-note">Last updated: ${DashboardPanel.escapeHtml(data.generatedAt)}</div>
        `;
    }

    private getManagedProviderSectionHtml(provider: ProviderName, data: DashboardPanelData): string {
        const filtered = data.managedResources.filter((item) => item.provider === provider);
        const offset = provider === 'Vercel' ? 0 : provider === 'Netlify' ? 100 : 200;
        const list = filtered.length
            ? filtered.map((item, index) => this.getManagedResourceRowHtml(item, index + offset)).join('')
            : provider === 'Vercel'
                ? '<li class="muted">No Vercel projects found.</li>'
                : provider === 'Coolify'
                    ? '<li class="muted">No Coolify apps found.</li>'
                    : '<li class="muted">No Netlify sites found.</li>';

        const title = provider === 'Vercel'
            ? 'Vercel Projects'
            : provider === 'Netlify'
                ? 'Netlify Sites'
                : 'Coolify Apps (Self-Host)';

        const count = provider === 'Vercel'
            ? data.vercelProjects.length
            : provider === 'Coolify'
                ? data.coolifyApps.length
                : data.netlifySites.length;

        return `
            <div class="provider-resource-section" data-provider-section="${provider}">
                <div class="provider-section-head">
                    <h3>${title} (<span data-provider-count="${provider}">${count}</span>)</h3>
                    <button
                        class="ghost-btn section-refresh-btn"
                        data-action="refresh-provider-resources"
                        data-provider="${provider}"
                        type="button"
                        title="Refresh ${title}"
                        aria-label="Reload ${title}"
                    >&#x21bb;</button>
                </div>
                <ul>${list}</ul>
            </div>
        `;
    }

    private getDashboardHtml(data: DashboardPanelData): string {
        const hasProvider = data.vercelConnected || data.coolifyConnected || data.netlifyConnected;
        const existsRemotely = data.projectExistsOnVercel || data.projectExistsOnCoolify || data.projectExistsOnNetlify;
        const deployedProviders: ProviderName[] = [];
        if (data.projectExistsOnVercel) {
            deployedProviders.push('Vercel');
        }
        if (data.projectExistsOnNetlify) {
            deployedProviders.push('Netlify');
        }
        if (data.projectExistsOnCoolify) {
            deployedProviders.push('Coolify');
        }

        const totalResources = data.vercelProjects.length + data.coolifyApps.length + data.netlifySites.length;
        const totalActivities = data.activity.length;

        const totalStateCount = Object.values(data.stateCounts).reduce((sum, value) => sum + value, 0) || 1;
        const stateBars = Object.entries(data.stateCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([state, count], index) => {
                const percent = Math.max(6, Math.round((count / totalStateCount) * 100));
                const hue = 218 + (index * 38);
                return `
                    <div class="state-row">
                        <div class="state-meta">
                            <span>${DashboardPanel.escapeHtml(state)}</span>
                            <strong>${count}</strong>
                        </div>
                        <div class="state-bar-track">
                            <div class="state-bar-fill" style="width: ${percent}%; background: linear-gradient(90deg, hsl(${hue} 78% 62%), hsl(${hue + 30} 86% 68%));"></div>
                        </div>
                    </div>
                `;
            })
            .join('');

        const activityRows = data.activity.length
            ? data.activity
                .map((entry, index) => {
                    const providerClass = entry.provider === 'Vercel'
                        ? 'badge-vercel'
                        : entry.provider === 'Coolify'
                            ? 'badge-coolify'
                            : 'badge-netlify';
                    return `
                        <div class="log-row">
                            <div class="log-main">
                                <div class="log-title-wrap">
                                    <span class="provider-badge ${providerClass}">${DashboardPanel.escapeHtml(entry.provider)}</span>
                                    <span class="log-title">${DashboardPanel.escapeHtml(entry.projectName)}</span>
                                    <span class="log-state">${DashboardPanel.escapeHtml(entry.state)}</span>
                                </div>
                                <small class="log-time">${DashboardPanel.escapeHtml(entry.timestampLabel)}</small>
                            </div>
                            <button
                                id="btn-log-${index}"
                                class="ghost-btn"
                                data-action="open-logs"
                                data-provider="${DashboardPanel.escapeHtml(entry.provider)}"
                                data-project-id="${DashboardPanel.escapeHtml(entry.projectId)}"
                                data-project-name="${DashboardPanel.escapeHtml(entry.projectName)}"
                                type="button"
                            >Logs</button>
                        </div>
                    `;
                })
                .join('')
            : '<div class="empty-block">No deployment activity yet. Connect providers to start tracking events.</div>';

        const projectSection = data.projectInfo
            ? `
                <div class="project-grid">
                    <div class="project-line"><span>Name</span><strong>${DashboardPanel.escapeHtml(data.projectInfo.name)}</strong></div>
                    <div class="project-line"><span>Branch</span><strong>${DashboardPanel.escapeHtml(data.projectInfo.branch)}</strong></div>
                    <div class="project-line"><span>Repository</span><strong>${DashboardPanel.escapeHtml(
                data.projectInfo.repoOwner && data.projectInfo.repoName
                    ? `${data.projectInfo.repoOwner}/${data.projectInfo.repoName}`
                    : 'Not detected'
            )}</strong></div>
                    <div class="project-line"><span>Status</span><strong class="${existsRemotely ? 'status-ok' : 'status-idle'
            }">${existsRemotely ? `Deployed in ${deployedProviders.join(', ')}` : 'Not Deployed'}</strong></div>
                </div>
            `
            : '<div class="empty-block">No workspace detected. Open a project folder to continue.</div>';

        const providerRows = `
            <div class="provider-row">
                <div>
                    <strong>Vercel</strong>
                    <small>${data.vercelConnected ? 'Connected and ready' : 'Not connected'}</small>
                </div>
                ${data.vercelConnected
                ? '<span class="status-pill connected">Connected</span>'
                : '<button id="btn-connect-vercel" class="accent-btn" type="button">Connect</button>'
            }
            </div>
            <div class="provider-row">
                <div>
                    <strong>Netlify</strong>
                    <small>${data.netlifyConnected ? 'Connected and ready' : 'Not connected'}</small>
                </div>
                ${data.netlifyConnected
                ? '<span class="status-pill connected">Connected</span>'
                : '<button id="btn-connect-netlify" class="accent-btn" type="button">Connect</button>'
            }
            </div>
            <div class="provider-row">
                <div>
                    <strong>Coolify</strong>
                    <small>${data.coolifyConnected ? 'Connected and ready' : 'Not connected'}</small>
                </div>
                ${data.coolifyConnected
                ? '<span class="status-pill connected">Connected</span>'
                : '<button id="btn-connect-coolify" class="accent-btn" type="button">Connect</button>'
            }
            </div>           
        `;

        const actionButtons = !hasProvider
            ? '<div class="empty-block">Connect Vercel, Coolify, or Netlify to unlock deployment actions.</div>'
            : `
                <div class="action-grid">
                    <button id="btn-refresh" class="accent-btn" type="button">Refresh Dashboard</button>
                    <button id="btn-deploy" class="primary-btn" type="button">Deploy Project</button>
                    <button id="btn-open-logs" class="ghost-btn" type="button">Open Logs</button>
                </div>
            `;

        const nonce = DashboardPanel.getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline';" />
                <title>Deployment Manager Dashboard</title>
                <style>
                    :root {
                        color-scheme: dark;
                    }

                    * {
                        box-sizing: border-box;
                    }

                    body {
                        margin: 0;
                        font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
                        color: #e8ecff;
                        background:
                            radial-gradient(1200px 600px at -20% -15%, rgba(118, 138, 255, 0.18), transparent 55%),
                            radial-gradient(800px 500px at 110% -10%, rgba(78, 208, 233, 0.12), transparent 50%),
                            #0d1022;
                    }

                    .shell {
                        padding: 22px;
                        display: grid;
                        gap: 16px;
                    }

                    .card {
                        background: linear-gradient(180deg, rgba(26, 31, 60, 0.94), rgba(17, 20, 42, 0.94));
                        border: 1px solid rgba(131, 150, 255, 0.24);
                        border-radius: 16px;
                        box-shadow: 0 10px 28px rgba(4, 8, 26, 0.45);
                        backdrop-filter: blur(4px);
                    }

                    .hero {
                        padding: 18px;
                        display: flex;
                        justify-content: space-between;
                        gap: 14px;
                        align-items: center;
                    }

                    .hero h1 {
                        margin: 0;
                        font-size: 24px;
                        font-weight: 700;
                        letter-spacing: 0.2px;
                    }

                    .hero p {
                        margin: 4px 0 0;
                        color: #b7bfd8;
                        font-size: 13px;
                    }

                    .hero-right {
                        display: flex;
                        gap: 10px;
                        flex-wrap: wrap;
                    }

                    .metric-pill {
                        min-width: 128px;
                        border-radius: 999px;
                        border: 1px solid rgba(126, 145, 255, 0.28);
                        padding: 8px 12px;
                        background: rgba(9, 12, 30, 0.62);
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 12px;
                    }

                    .metric-pill strong {
                        font-size: 15px;
                        color: #f2f5ff;
                    }

                    .grid-top {
                        display: grid;
                        grid-template-columns: minmax(260px, 1fr) minmax(280px, 1fr);
                        gap: 16px;
                    }

                    .grid-bottom {
                        display: grid;
                        grid-template-columns: repeat(3, minmax(220px, 1fr));
                        gap: 16px;
                    }

                    .section {
                        padding: 16px;
                    }

                    .section h2 {
                        margin: 0 0 12px;
                        font-size: 14px;
                        letter-spacing: 0.3px;
                        text-transform: uppercase;
                        color: #ced6ff;
                    }

                    .state-row {
                        display: grid;
                        gap: 6px;
                        margin-bottom: 11px;
                    }

                    .state-meta {
                        display: flex;
                        justify-content: space-between;
                        font-size: 12px;
                        color: #c7d2ff;
                    }

                    .state-bar-track {
                        width: 100%;
                        height: 11px;
                        border-radius: 999px;
                        background: rgba(8, 13, 34, 0.9);
                        border: 1px solid rgba(108, 129, 255, 0.24);
                        overflow: hidden;
                    }

                    .state-bar-fill {
                        height: 100%;
                        border-radius: 999px;
                        transition: width 280ms ease;
                    }

                    .log-list {
                        max-height: 230px;
                        overflow: auto;
                        display: grid;
                        gap: 9px;
                    }

                    .log-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        gap: 10px;
                        background: rgba(11, 15, 36, 0.76);
                        border: 1px solid rgba(126, 142, 232, 0.21);
                        border-radius: 10px;
                        padding: 9px 10px;
                    }

                    .log-main {
                        min-width: 0;
                    }

                    .log-title-wrap {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 6px;
                        align-items: center;
                    }

                    .log-title {
                        font-weight: 600;
                        color: #ecf1ff;
                    }

                    .log-state {
                        color: #aeb7d5;
                        font-size: 12px;
                    }

                    .log-time {
                        color: #91a0cc;
                        font-size: 11px;
                    }

                    .provider-badge {
                        display: inline-flex;
                        align-items: center;
                        border-radius: 999px;
                        font-size: 10px;
                        font-weight: 600;
                        letter-spacing: 0.3px;
                        padding: 3px 8px;
                        text-transform: uppercase;
                    }

                    .badge-vercel {
                        background: rgba(82, 107, 255, 0.28);
                        border: 1px solid rgba(125, 150, 255, 0.44);
                    }

                    .badge-coolify {
                        background: rgba(77, 207, 224, 0.22);
                        border: 1px solid rgba(112, 229, 247, 0.38);
                    }

                    .badge-netlify {
                        background: rgba(93, 226, 193, 0.2);
                        border: 1px solid rgba(129, 244, 214, 0.38);
                    }

                    .project-grid {
                        display: grid;
                        gap: 10px;
                    }

                    .project-line {
                        display: flex;
                        justify-content: space-between;
                        gap: 12px;
                        align-items: center;
                        font-size: 13px;
                        color: #c8d2f7;
                    }

                    .project-line strong {
                        color: #f2f6ff;
                        text-align: right;
                        max-width: 68%;
                        word-break: break-word;
                    }

                    .status-ok {
                        color: #6bf7c2 !important;
                    }

                    .status-idle {
                        color: #f8cf79 !important;
                    }

                    .provider-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        gap: 12px;
                        padding: 10px;
                        border-radius: 10px;
                        border: 1px solid rgba(123, 143, 240, 0.2);
                        background: rgba(9, 14, 31, 0.68);
                        margin-bottom: 10px;
                    }

                    .provider-row strong {
                        display: block;
                    }

                    .provider-row small {
                        color: #94a1cb;
                    }

                    .action-grid {
                        display: grid;
                        gap: 10px;
                    }

                    button {
                        border: none;
                        border-radius: 10px;
                        padding: 9px 12px;
                        color: #f4f7ff;
                        font-weight: 600;
                        letter-spacing: 0.2px;
                        cursor: pointer;
                        transition: transform 140ms ease, filter 140ms ease;
                    }

                    button:hover {
                        transform: translateY(-1px);
                        filter: brightness(1.06);
                    }

                    .primary-btn {
                        background: linear-gradient(135deg, #586dff, #42d0ff);
                    }

                    .accent-btn {
                        background: linear-gradient(135deg, #4b89ff, #4f60db);
                    }

                    .ghost-btn {
                        background: rgba(104, 123, 220, 0.2);
                        border: 1px solid rgba(132, 150, 246, 0.38);
                        color: #dbe3ff;
                    }

                    .status-pill {
                        font-size: 11px;
                        padding: 6px 10px;
                        border-radius: 999px;
                        border: 1px solid rgba(117, 138, 242, 0.37);
                    }

                    .status-pill.connected {
                        color: #73f0bf;
                        background: rgba(57, 179, 125, 0.18);
                        border-color: rgba(91, 235, 170, 0.38);
                    }

                    .resource-grid {
                        display: grid;
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                        gap: 0;
                        border: 1px solid rgba(120, 136, 226, 0.18);
                        border-radius: 12px;
                        overflow: hidden;
                    }

                    .provider-resource-section {
                        position: relative;
                        padding: 12px;
                        background: linear-gradient(180deg, rgba(22, 30, 60, 0.55), rgba(12, 18, 36, 0.75));
                        min-height: 260px;
                    }

                    .provider-resource-section + .provider-resource-section {
                        border-left: 1px solid rgba(120, 136, 226, 0.18);
                    }

                    .provider-resource-section.is-loading {
                        opacity: 0.55;
                    }

                    .provider-section-head {
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        gap: 8px;
                        margin-bottom: 10px;
                    }

                    .provider-section-head h3 {
                        margin: 0;
                        font-size: 13px;
                        font-weight: 700;
                    }

                    .section-refresh-btn {
                        min-height: 22px;
                        min-width: 22px;
                        width: 22px;
                        padding: 0;
                        line-height: 1;
                        border-radius: 6px;
                        font-size: 12px;
                    }

                    .resource-grid ul {
                        list-style: none;
                        margin: 0;
                        padding: 0;
                        display: grid;
                        gap: 10px;
                    }

                    .resource-grid li {
                        display: flex;
                        justify-content: space-between;
                        gap: 10px;
                        align-items: flex-start;
                        font-size: 13px;
                        padding: 10px;
                        border-radius: 8px;
                        border: 1px solid rgba(110, 128, 230, 0.24);
                        background: linear-gradient(180deg, rgba(18, 27, 54, 0.76), rgba(12, 18, 38, 0.85));
                    }

                    .resource-grid small {
                        color: #9eacd6;
                    }

                    .resource-item {
                        align-items: flex-start !important;
                    }

                    .resource-meta {
                        min-width: 0;
                        display: grid;
                        gap: 6px;
                        flex: 1;
                    }

                    .resource-title {
                        font-size: 13px;
                        font-weight: 700;
                        line-height: 1.2;
                    }

                    .resource-subtitle {
                        font-size: 11px;
                        line-height: 1.2;
                        color: #9eacd6;
                    }

                    .resource-actions {
                        display: grid;
                        gap: 4px;
                        justify-items: end;
                        max-width: 260px;
                    }

                    .resource-btn {
                        min-height: 24px;
                        padding: 3px 8px;
                        font-size: 11px;
                    }

                    .git-pill {
                        font-size: 10px;
                        padding: 2px 8px;
                        border-radius: 999px;
                        width: fit-content;
                        border: 1px solid transparent;
                    }

                    .git-pill-ok {
                        color: #75f3c7;
                        background: rgba(57, 179, 125, 0.18);
                        border-color: rgba(91, 235, 170, 0.38);
                    }

                    .git-pill-warning {
                        color: #ffd994;
                        background: rgba(240, 152, 56, 0.18);
                        border-color: rgba(255, 184, 95, 0.38);
                    }

                    .git-pill-error {
                        color: #ffb0b0;
                        background: rgba(209, 66, 66, 0.2);
                        border-color: rgba(255, 118, 118, 0.42);
                    }

                    .resource-actions .ghost-btn[disabled] {
                        cursor: not-allowed;
                        opacity: 0.7;
                        transform: none;
                    }

                    .redeploy-status {
                        min-height: 14px;
                        display: block;
                        max-width: 260px;
                        text-align: right;
                        font-size: 11px;
                        line-height: 1.25;
                        color: #9eacd6;
                        word-break: break-word;
                    }

                    .redeploy-status.ok {
                        color: #75f3c7;
                    }

                    .redeploy-status.error {
                        color: #ffabab;
                    }

                    .redeploy-log-shell {
                        display: none;
                        margin-top: 12px;
                        border: 1px solid rgba(126, 144, 238, 0.35);
                        border-radius: 10px;
                        background: rgba(9, 13, 33, 0.82);
                        overflow: hidden;
                    }

                    .redeploy-log-shell.is-visible {
                        display: block;
                    }

                    .redeploy-log-title {
                        font-size: 11px;
                        font-weight: 600;
                        color: #b9c7f4;
                        padding: 8px 10px;
                        border-bottom: 1px solid rgba(126, 144, 238, 0.2);
                        background: rgba(126, 144, 238, 0.08);
                    }

                    .redeploy-log-view {
                        display: block;
                        margin: 0;
                        max-height: 170px;
                        overflow: auto;
                        text-align: left;
                        color: #d9e3ff;
                        padding: 8px 10px;
                        font-size: 10px;
                        line-height: 1.32;
                        white-space: pre-wrap;
                        word-break: break-word;
                        font-family: Consolas, 'Courier New', monospace;
                    }

                    .redeploy-log-view::-webkit-scrollbar {
                        width: 8px;
                    }

                    .redeploy-log-view::-webkit-scrollbar-thumb {
                        background: rgba(126, 144, 238, 0.45);
                        border-radius: 999px;
                    }

                    #managed-resources-body {
                        position: relative;
                    }

                    #managed-resources-body.is-loading {
                        opacity: 0.55;
                    }

                    #managed-resources-body.is-loading::after {
                        content: '';
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        width: 24px;
                        height: 24px;
                        margin-top: -12px;
                        margin-left: -12px;
                        border: 3px solid rgba(130, 146, 255, 0.24);
                        border-top-color: #7b96ff;
                        border-radius: 999px;
                        animation: spin 0.8s linear infinite;
                        pointer-events: none;
                    }

                    .check-git-status {
                        min-height: 14px;
                        margin-top: 6px;
                        font-size: 11px;
                        color: #95a2c9;
                    }

                    .check-git-status.error {
                        color: #ffabab;
                    }

                    .empty-block,
                    .muted {
                        color: #95a2c9;
                        font-size: 12px;
                    }

                    .footer-note {
                        margin-top: 12px;
                        color: #8a9aca;
                        font-size: 11px;
                    }

                    .runtime-error-banner {
                        position: sticky;
                        top: 0;
                        z-index: 30;
                        margin-bottom: 10px;
                        border: 1px solid rgba(255, 138, 138, 0.45);
                        border-radius: 10px;
                        background: linear-gradient(180deg, rgba(78, 19, 19, 0.96), rgba(42, 14, 14, 0.96));
                        color: #ffd6d6;
                        padding: 10px 12px;
                        font-size: 12px;
                        line-height: 1.35;
                        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
                    }

                    .runtime-error-banner strong {
                        display: block;
                        margin-bottom: 4px;
                        color: #ffe8e8;
                    }

                    .runtime-error-banner code {
                        display: block;
                        margin-top: 4px;
                        white-space: pre-wrap;
                        word-break: break-word;
                        color: #ffdede;
                        font-family: Consolas, 'Courier New', monospace;
                        font-size: 11px;
                    }

                    @keyframes spin {
                        to {
                            transform: rotate(360deg);
                        }
                    }

                    @media (max-width: 1060px) {
                        .grid-top {
                            grid-template-columns: 1fr;
                        }

                        .grid-bottom {
                            grid-template-columns: 1fr;
                        }

                        .resource-grid {
                            grid-template-columns: 1fr;
                        }

                        .provider-resource-section + .provider-resource-section {
                            border-left: none;
                            border-top: 1px solid rgba(120, 136, 226, 0.18);
                        }
                    }
                </style>
            </head>
            <body>
                <main class="shell">
                    <section class="card hero" aria-label="Dashboard header">
                        <div>
                            <h1 id="deployment-dashboard-title">🚀 Deployment Manager Dashboard</h1>
                            <p>Open in tab, close when idle, and manage all deployment operations from one place.</p>
                        </div>
                        <div class="hero-right">
                            <div class="metric-pill"><span>Resources</span><strong>${totalResources}</strong></div>
                            <div class="metric-pill"><span>Activities</span><strong>${totalActivities}</strong></div>
                        </div>
                    </section>

                    <section class="grid-top">
                        <article class="card section" aria-labelledby="stats-heading">
                            <h2 id="stats-heading">Deployment Stats</h2>
                            ${stateBars}
                        </article>
                        <article class="card section" aria-labelledby="activity-heading">
                            <h2 id="activity-heading">Activity Log</h2>
                            <div class="log-list">
                                ${activityRows}
                            </div>
                        </article>
                    </section>

                    <section class="grid-bottom">
                        <article class="card section" aria-labelledby="project-heading">
                            <h2 id="project-heading">Current Workspace Project</h2>
                            ${projectSection}
                        </article>

                        <article class="card section" aria-labelledby="provider-heading">
                            <h2 id="provider-heading">Providers</h2>
                            ${providerRows}
                        </article>

                        <article class="card section" aria-labelledby="actions-heading">
                            <h2 id="actions-heading">General Actions</h2>
                            ${actionButtons}
                        </article>
                    </section>

                    <section class="card section" aria-labelledby="resources-heading">
                        <div class="provider-row">
                            <div>
                                <h2 id="resources-heading">Managed Resources</h2>
                                <small id="latest-commit-label">Latest commit: ${DashboardPanel.escapeHtml(data.latestCommitLabel)}</small>
                                <div id="check-git-status" class="check-git-status"></div>
                            </div>
                            <button id="btn-check-git" class="accent-btn" type="button">Refresh</button>
                        </div>
                        <div id="managed-resources-body">
                            ${this.getManagedResourcesBodyHtml(data)}
                        </div>
                    </section>
                </main>

                <script nonce="${nonce}">
                    (function() {
                        const globalScope = (typeof globalThis !== 'undefined' ? globalThis : window) as any;
                        const vscodeApi = (function() {
                            const cacheKey = '__deploymentManagerApi';
                            if (globalScope[cacheKey]) {
                                return globalScope[cacheKey];
                            }
                            if (typeof acquireVsCodeApi === 'function') {
                                try {
                                    const api = acquireVsCodeApi();
                                    globalScope[cacheKey] = api;
                                    return api;
                                } catch (e) {
                                    console.warn('[dashboard] acquire failed', e);
                                }
                            }
                            return null;
                        })();

                        function showRuntimeErrorBanner(message) {
                            try {
                                console.error('[dashboard] error banner:', message);
                                const text = String(message || 'Unknown error');
                                const root = document.querySelector('main.shell') || document.body;
                                if (!root) return;
                                
                                const existing = document.getElementById('runtime-error-banner');
                                if (existing) {
                                    const code = existing.querySelector('code');
                                    if (code) code.textContent = text;
                                    return;
                                }

                                const banner = document.createElement('section');
                                banner.id = 'runtime-error-banner';
                                banner.className = 'runtime-error-banner';
                                banner.innerHTML = '<strong>Dashboard script error</strong><div>Interactions may be degraded.</div><code></code>';
                                const code = banner.querySelector('code');
                                if (code) code.textContent = text;
                                root.prepend(banner);
                            } catch (e) {
                                console.error('[dashboard] banner failed', e);
                            }
                        }

                        function send(command, payload = {}) {
                            console.log('[dashboard] dispatch:', command, payload);
                            if (!vscodeApi) {
                                showRuntimeErrorBanner('VS Code API not available.');
                                return;
                            }
                            try {
                                vscodeApi.postMessage({ command, ...payload });
                            } catch (e) {
                                showRuntimeErrorBanner('Message failed: ' + String(e));
                            }
                        }

                        const pendingRequests = new Map();
                        function sendWithReply(command, payload = {}, expectedCommand = 'redeployResult') {
                            const requestId = Date.now() + '-' + Math.random().toString(36).substring(2);
                            return new Promise((resolve) => {
                                const timeout = setTimeout(() => {
                                    pendingRequests.delete(requestId);
                                    resolve({ success: false, error: 'Timed out' });
                                }, 30000);
                                pendingRequests.set(requestId, { resolve, expectedCommand, timeout });
                                send(command, { ...payload, requestId });
                            });
                        }

                        function bindClick(id, command) {
                            const el = document.getElementById(id);
                            if (el) {
                                el.addEventListener('click', () => {
                                    console.log('[dashboard] click:', id);
                                    send(command);
                                });
                            }
                        }

                        window.addEventListener('message', (event) => {
                            const msg = event.data;
                            if (msg && msg.requestId) {
                                const pending = pendingRequests.get(msg.requestId);
                                if (pending && pending.expectedCommand === msg.command) {
                                    pendingRequests.delete(msg.requestId);
                                    clearTimeout(pending.timeout);
                                    pending.resolve(msg);
                                }
                            }
                        });

                        window.addEventListener('error', (e) => {
                            showRuntimeErrorBanner(e.error || e.message);
                        });

                        function bindResourceButtons() {
                            const buttons = document.querySelectorAll('[data-action]');
                            console.log('[dashboard] binding', buttons.length, 'action buttons');
                            buttons.forEach(btn => {
                                if ((btn as HTMLElement).dataset.bound) return;
                                (btn as HTMLElement).dataset.bound = 'true';
                                
                                btn.addEventListener('click', async (e) => {
                                    const action = (btn as HTMLElement).dataset.action;
                                    console.log('[dashboard] action click:', action);
                                    
                                    if (action === 'redeploy-resource') {
                                        const provider = btn.getAttribute('data-provider') || '';
                                        const projectId = btn.getAttribute('data-project-id') || '';
                                        const projectName = btn.getAttribute('data-project-name') || '';
                                        const resourceKey = btn.getAttribute('data-resource-key') || '';
                                        
                                        const baseLabel = btn.textContent;
                                        btn.textContent = '...';
                                        (btn as HTMLButtonElement).disabled = true;
                                        
                                        const result = await sendWithReply('redeployResource', { provider, projectId, projectName, resourceKey }, 'redeployResult');
                                        
                                        (btn as HTMLButtonElement).disabled = false;
                                        btn.textContent = baseLabel;
                                        
                                        if (result.success) {
                                           const statusEl = document.getElementById('redeploy-status-' + resourceKey);
                                           if (statusEl) statusEl.textContent = 'Ready';
                                        }
                                    } else if (action === 'open-logs') {
                                        send('openLogs', {
                                            provider: btn.getAttribute('data-provider'),
                                            projectId: btn.getAttribute('data-project-id'),
                                            projectName: btn.getAttribute('data-project-name')
                                        });
                                    } else if (action === 'visit-site') {
                                        send('visitResourceSite', {
                                            provider: btn.getAttribute('data-provider'),
                                            projectId: btn.getAttribute('data-project-id'),
                                            siteUrl: btn.getAttribute('data-site-url')
                                        });
                                    } else if (action === 'import-env') {
                                        const resourceKey = btn.getAttribute('data-resource-key') || '';
                                        const baseLabel = btn.textContent;
                                        btn.textContent = '...';
                                        (btn as HTMLButtonElement).disabled = true;
                                        
                                        const result = await sendWithReply('importResourceEnv', {
                                            provider: btn.getAttribute('data-provider'),
                                            projectId: btn.getAttribute('data-project-id')
                                        }, 'importEnvResult');
                                        
                                        (btn as HTMLButtonElement).disabled = false;
                                        btn.textContent = baseLabel;
                                        
                                        const statusEl = document.getElementById('import-status-' + resourceKey);
                                        if (statusEl) statusEl.textContent = result.success ? 'Imported' : 'Failed';
                                    } else if (action === 'refresh-provider-resources') {
                                        const provider = btn.getAttribute('data-provider') || '';
                                        const baseLabel = btn.textContent;
                                        btn.textContent = '...';
                                        (btn as HTMLButtonElement).disabled = true;
                                        
                                        const result = await sendWithReply('refreshProviderResources', { provider }, 'refreshProviderResourcesResult');
                                        
                                        (btn as HTMLButtonElement).disabled = false;
                                        btn.textContent = baseLabel;
                                        
                                        if (result.success && result.providerSectionHtml) {
                                            const section = document.querySelector('[data-provider-section="' + provider + '"]');
                                            if (section) {
                                                section.outerHTML = result.providerSectionHtml;
                                                bindResourceButtons();
                                            }
                                        }
                                    }
                                });
                            });
                        }

                        // Initialize
                        try {
                            bindClick('btn-refresh', 'refresh');
                            bindClick('btn-connect-vercel', 'connectVercel');
                            bindClick('btn-connect-coolify', 'connectCoolify');
                            bindClick('btn-connect-netlify', 'connectNetlify');
                            bindClick('btn-deploy', 'deployProject');
                            bindClick('btn-open-logs', 'openLogs');
                            
                            const checkGitBtn = document.getElementById('btn-check-git');
                            if (checkGitBtn) {
                                checkGitBtn.addEventListener('click', async () => {
                                    const original = checkGitBtn.textContent;
                                    checkGitBtn.textContent = '...';
                                    (checkGitBtn as HTMLButtonElement).disabled = true;
                                    
                                    const res = await sendWithReply('checkGitUpdates', {}, 'checkGitUpdatesResult');
                                    
                                    (checkGitBtn as HTMLButtonElement).disabled = false;
                                    checkGitBtn.textContent = original;
                                    
                                    if (res.success && res.sectionBodyHtml) {
                                        const body = document.getElementById('managed-resources-body');
                                        if (body) {
                                            body.innerHTML = res.sectionBodyHtml;
                                            bindResourceButtons();
                                        }
                                    }
                                });
                            }

                            bindResourceButtons();
                            console.log('[dashboard] initialization complete');
                        } catch (e) {
                            showRuntimeErrorBanner('Initialization failed: ' + e.message);
                        }
                    })();
                </script>
            </body>
            </html>
        `;
    }

    private getLoadingHtml(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Loading Dashboard</title>
                <style>
                    body {
                        margin: 0;
                        min-height: 100vh;
                        display: grid;
                        place-items: center;
                        color: #e9efff;
                        font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
                        background: radial-gradient(circle at 30% 15%, rgba(83, 108, 255, 0.25), transparent 40%), #0b1023;
                    }
                    .loading {
                        text-align: center;
                    }
                    .spinner {
                        width: 28px;
                        height: 28px;
                        border-radius: 999px;
                        margin: 0 auto 12px;
                        border: 3px solid rgba(130, 146, 255, 0.24);
                        border-top-color: #7b96ff;
                        animation: spin 0.9s linear infinite;
                    }
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="loading">
                    <div class="spinner"></div>
                    <div>Loading Deployment Manager dashboard...</div>
                </div>
            </body>
            </html>
        `;
    }

    private getErrorHtml(message: string): string {
        const nonce = DashboardPanel.getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline';" />
                <title>Dashboard Error</title>
                <style>
                    body {
                        margin: 0;
                        min-height: 100vh;
                        display: grid;
                        place-items: center;
                        padding: 20px;
                        background: #0b1022;
                        color: #f1f5ff;
                        font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
                    }
                    .error-card {
                        max-width: 640px;
                        width: 100%;
                        border-radius: 14px;
                        border: 1px solid rgba(231, 120, 120, 0.45);
                        background: rgba(42, 15, 23, 0.9);
                        padding: 18px;
                    }
                    pre {
                        white-space: pre-wrap;
                        background: rgba(0, 0, 0, 0.24);
                        border-radius: 8px;
                        padding: 10px;
                        color: #ffd6d6;
                    }
                    button {
                        margin-top: 12px;
                        border: none;
                        border-radius: 9px;
                        padding: 8px 12px;
                        cursor: pointer;
                        color: #f3f6ff;
                        background: linear-gradient(135deg, #6077ff, #59beff);
                    }
                </style>
            </head>
            <body>
                <div class="error-card">
                    <h2>Dashboard failed to render</h2>
                    <pre>${DashboardPanel.escapeHtml(message)}</pre>
                    <button id="btn-refresh" type="button">Retry</button>
                </div>
                <script nonce="${nonce}">
                    const vscode = typeof acquireVsCodeApi === 'function'
                        ? acquireVsCodeApi()
                        : { postMessage: (...args) => console.warn('[dashboard:error] postMessage fallback', args) };
                    document.getElementById('btn-refresh')?.addEventListener('click', () => {
                        vscode.postMessage({ command: 'refresh' });
                    });
                </script>
            </body>
            </html>
        `;
    }

    private dispose(): void {
        DashboardPanel.currentPanel = undefined;

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            disposable?.dispose();
        }
    }

    private static normalizeTimestamp(value: string | number | undefined): number {
        if (typeof value === 'number') {
            return value > 10_000_000_000 ? value : value * 1000;
        }

        if (!value) {
            return Date.now();
        }

        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? Date.now() : parsed;
    }

    private static formatTimestamp(value: string | number | undefined): string {
        return new Date(DashboardPanel.normalizeTimestamp(value)).toLocaleString();
    }

    private static formatRelativeTime(value: string | number): string {
        const timestamp = DashboardPanel.normalizeTimestamp(value);
        const diffMs = Date.now() - timestamp;
        const absMs = Math.abs(diffMs);

        const minute = 60_000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (absMs < minute) {
            return 'just now';
        }

        if (absMs < hour) {
            const amount = Math.floor(absMs / minute);
            return `${amount} min${amount === 1 ? '' : 's'} ago`;
        }

        if (absMs < day) {
            const amount = Math.floor(absMs / hour);
            return `${amount} hour${amount === 1 ? '' : 's'} ago`;
        }

        const amount = Math.floor(absMs / day);
        return `${amount} day${amount === 1 ? '' : 's'} ago`;
    }

    private static toTitleCase(value: string): string {
        return value
            .replace(/[_-]+/g, ' ')
            .split(/\s+/)
            .filter((part) => part.length > 0)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(' ');
    }

    private static escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private static getNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i += 1) {
            nonce += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return nonce;
    }
}
