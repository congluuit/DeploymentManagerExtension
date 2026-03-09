import * as vscode from 'vscode';
import { CoolifyClient } from '../clients/coolifyClient';
import { VercelClient } from '../clients/vercelClient';
import { ProjectDetector } from '../services/projectDetector';
import { SecretStorageManager } from '../utils/secretStorage';
import {
    CoolifyApplication,
    ProjectInfo,
    StorageKeys,
    VercelDeployment,
    VercelProject,
} from '../utils/types';

type ProviderName = 'Vercel' | 'Coolify';

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
    projectExistsOnVercel: boolean;
    projectExistsOnCoolify: boolean;
    vercelProjects: VercelProject[];
    coolifyApps: CoolifyApplication[];
    activity: DashboardActivityItem[];
    stateCounts: Record<string, number>;
}

interface DashboardWebviewMessage {
    command:
    | 'refresh'
    | 'connectVercel'
    | 'connectCoolify'
    | 'deployProject'
    | 'redeployProject'
    | 'openLogs';
    provider?: string;
    projectId?: string;
    projectName?: string;
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
                retainContextWhenHidden: true,
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
            case 'connectVercel':
                await vscode.commands.executeCommand('deploymentManager.connectVercel');
                await this.runRefresh();
                return;
            case 'connectCoolify':
                await vscode.commands.executeCommand('deploymentManager.connectCoolify');
                await this.runRefresh();
                return;
            case 'deployProject':
                await vscode.commands.executeCommand('deploymentManager.deployProject');
                await this.runRefresh();
                return;
            case 'redeployProject':
                await vscode.commands.executeCommand('deploymentManager.redeployProject');
                await this.runRefresh();
                return;
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

        let projectExistsOnVercel = false;
        let projectExistsOnCoolify = false;

        let vercelProjects: VercelProject[] = [];
        let coolifyApps: CoolifyApplication[] = [];
        const activity: DashboardActivityItem[] = [];

        if (vercelConnected) {
            try {
                const vercel = new VercelClient();
                vercelProjects = await vercel.listProjects();

                if (projectInfo) {
                    const matched = await vercel.findProjectByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
                    projectExistsOnVercel = matched !== null;

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
                    projectExistsOnCoolify = matched !== null;
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

        activity.sort((a, b) => b.timestamp - a.timestamp);
        const trimmedActivity = activity.slice(0, 20);

        const stateCounts = this.buildStateCounts(trimmedActivity);

        return {
            generatedAt: new Date().toLocaleString(),
            projectInfo,
            vercelConnected,
            coolifyConnected,
            projectExistsOnVercel,
            projectExistsOnCoolify,
            vercelProjects,
            coolifyApps,
            activity: trimmedActivity,
            stateCounts,
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
                state: deployment.state,
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

    private getDashboardHtml(data: DashboardPanelData): string {
        const hasProvider = data.vercelConnected || data.coolifyConnected;
        const existsRemotely = data.projectExistsOnVercel || data.projectExistsOnCoolify;

        const totalResources = data.vercelProjects.length + data.coolifyApps.length;
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
                    const providerClass = entry.provider === 'Vercel' ? 'badge-vercel' : 'badge-coolify';
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
            }">${existsRemotely ? 'Deployed' : 'Not Deployed'}</strong></div>
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
            ? '<div class="empty-block">Connect Vercel or Coolify to unlock deployment actions.</div>'
            : `
                <div class="action-grid">
                    <button id="btn-refresh" class="accent-btn" type="button">Refresh Data</button>
                    ${existsRemotely
                ? '<button id="btn-redeploy" class="primary-btn" type="button">Redeploy Project</button>'
                : '<button id="btn-deploy" class="primary-btn" type="button">Deploy Project</button>'
            }
                    <button id="btn-open-logs" class="ghost-btn" type="button">Open Logs</button>
                </div>
            `;

        const vercelList = data.vercelProjects.length
            ? data.vercelProjects
                .slice(0, 10)
                .map(
                    (project) => `
                        <li>
                            <span>${DashboardPanel.escapeHtml(project.name)}</span>
                            <small>${DashboardPanel.escapeHtml(project.framework ?? 'framework n/a')}</small>
                        </li>
                    `
                )
                .join('')
            : '<li class="muted">No Vercel projects found.</li>';

        const coolifyList = data.coolifyApps.length
            ? data.coolifyApps
                .slice(0, 10)
                .map(
                    (app) => `
                        <li>
                            <span>${DashboardPanel.escapeHtml(app.name)}</span>
                            <small>${DashboardPanel.escapeHtml(app.status || 'status n/a')}</small>
                        </li>
                    `
                )
                .join('')
            : '<li class="muted">No Coolify apps found.</li>';

        const nonce = DashboardPanel.getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
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
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                        gap: 12px;
                    }

                    .resource-grid ul {
                        list-style: none;
                        margin: 0;
                        padding: 0;
                        display: grid;
                        gap: 8px;
                    }

                    .resource-grid li {
                        display: flex;
                        justify-content: space-between;
                        gap: 8px;
                        align-items: center;
                        font-size: 13px;
                        padding: 8px 10px;
                        border-radius: 9px;
                        border: 1px solid rgba(125, 141, 232, 0.2);
                        background: rgba(9, 14, 31, 0.68);
                    }

                    .resource-grid small {
                        color: #9eacd6;
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
                            <h2 id="actions-heading">Quick Actions</h2>
                            ${actionButtons}
                        </article>
                    </section>

                    <section class="card section" aria-labelledby="resources-heading">
                        <h2 id="resources-heading">Managed Resources</h2>
                        <div class="resource-grid">
                            <div>
                                <h3>Vercel Projects (${data.vercelProjects.length})</h3>
                                <ul>${vercelList}</ul>
                            </div>
                            <div>
                                <h3>Coolify Apps (${data.coolifyApps.length})</h3>
                                <ul>${coolifyList}</ul>
                            </div>
                        </div>
                        <div class="footer-note">Last updated: ${DashboardPanel.escapeHtml(data.generatedAt)}</div>
                    </section>
                </main>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();

                    function send(command, payload = {}) {
                        vscode.postMessage({ command, ...payload });
                    }

                    const refreshButton = document.getElementById('btn-refresh');
                    if (refreshButton) {
                        refreshButton.addEventListener('click', () => send('refresh'));
                    }

                    const connectVercelButton = document.getElementById('btn-connect-vercel');
                    if (connectVercelButton) {
                        connectVercelButton.addEventListener('click', () => send('connectVercel'));
                    }

                    const connectCoolifyButton = document.getElementById('btn-connect-coolify');
                    if (connectCoolifyButton) {
                        connectCoolifyButton.addEventListener('click', () => send('connectCoolify'));
                    }

                    const deployButton = document.getElementById('btn-deploy');
                    if (deployButton) {
                        deployButton.addEventListener('click', () => send('deployProject'));
                    }

                    const redeployButton = document.getElementById('btn-redeploy');
                    if (redeployButton) {
                        redeployButton.addEventListener('click', () => send('redeployProject'));
                    }

                    const openLogsButton = document.getElementById('btn-open-logs');
                    if (openLogsButton) {
                        openLogsButton.addEventListener('click', () => send('openLogs'));
                    }

                    const logButtons = document.querySelectorAll('[data-action="open-logs"]');
                    for (const logButton of logButtons) {
                        logButton.addEventListener('click', () => {
                            send('openLogs', {
                                provider: logButton.getAttribute('data-provider') || undefined,
                                projectId: logButton.getAttribute('data-project-id') || undefined,
                                projectName: logButton.getAttribute('data-project-name') || undefined,
                            });
                        });
                    }
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
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
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
                    const vscode = acquireVsCodeApi();
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
