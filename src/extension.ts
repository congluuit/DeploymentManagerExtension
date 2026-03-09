import * as vscode from 'vscode';
import { SecretStorageManager } from './utils/secretStorage';
import { DashboardProvider } from './views/dashboardProvider';
import { DashboardLauncherProvider } from './views/dashboardLauncherProvider';
import { DashboardPanel } from './views/dashboardPanel';
import { CommitWatcher } from './services/commitWatcher';
import { connectVercel, connectCoolify, connectNetlify } from './commands/connectProvider';
import { deployProject } from './commands/deployProject';
import { redeployProject } from './commands/redeployProject';
import { refreshProjects } from './commands/refreshProjects';
import { openLogs } from './commands/openLogs';
import { ProviderName } from './providers/providerTypes';

let commitWatcher: CommitWatcher | null = null;

/**
 * Extension activation entry point.
 * Called automatically when Antigravity starts (onStartupFinished).
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('Deployment Manager extension is now active!');

    // Initialize secure storage
    SecretStorageManager.initialize(context.secrets);

    // Keep the existing data provider for refresh + commit watcher data.
    const dashboardProvider = new DashboardProvider();

    // Sidebar now acts as a launcher; full dashboard opens in a closeable tab.
    const launcherProvider = new DashboardLauncherProvider();

    const treeView = vscode.window.createTreeView('deploymentManagerDashboard', {
        treeDataProvider: launcherProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);

    let skipFirstVisibilityEvent = treeView.visible;
    context.subscriptions.push(
        treeView.onDidChangeVisibility((event) => {
            if (skipFirstVisibilityEvent) {
                skipFirstVisibilityEvent = false;
                return;
            }

            if (event.visible) {
                void vscode.commands.executeCommand('deploymentManager.openDashboard');
            }
        })
    );

    // Create the refresh callback
    const doRefresh = async (): Promise<void> => {
        await dashboardProvider.refresh();
        updateCommitWatcher(dashboardProvider);
        DashboardPanel.refreshCurrentPanel();
    };

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.openDashboard', async () => {
            DashboardPanel.createOrShow(context.extensionUri, doRefresh);
            await doRefresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.connectVercel', async () => {
            const success = await connectVercel();
            if (success) {
                await doRefresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.connectCoolify', async () => {
            const success = await connectCoolify();
            if (success) {
                await doRefresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.connectNetlify', async () => {
            const success = await connectNetlify();
            if (success) {
                await doRefresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.deployProject', async () => {
            await deployProject(doRefresh);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.redeployProject', async (payload?: { target?: { provider?: string; id?: string; name?: string }; notify?: boolean; refresh?: boolean }) => {
            const target = payload?.target;
            const provider: ProviderName | undefined =
                target?.provider === 'Vercel' || target?.provider === 'Coolify' || target?.provider === 'Netlify'
                    ? target.provider
                    : undefined;
            const parsedTarget =
                provider &&
                    typeof target?.id === 'string' &&
                    target.id.length > 0 &&
                    typeof target?.name === 'string' &&
                    target.name.length > 0
                    ? { provider, id: target.id, name: target.name }
                    : undefined;
            return redeployProject(doRefresh, {
                target: parsedTarget,
                notify: payload?.notify,
                refreshDashboard: payload?.refresh,
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.refreshProjects', async () => {
            await refreshProjects(doRefresh);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('deploymentManager.openLogs', async (item?: { meta?: { provider?: string; projectId?: string; projectName?: string } }) => {
            if (item?.meta) {
                await openLogs(item.meta.provider, item.meta.projectId, item.meta.projectName);
            } else {
                await openLogs();
            }
        })
    );

    // Initial refresh — preload state for commit watcher and dashboard.
    void doRefresh();
}

/**
 * Start or update the commit watcher based on current dashboard state.
 */
function updateCommitWatcher(dashboard: DashboardProvider): void {
    const projectInfo = dashboard.getProjectInfo();

    if (!projectInfo || !projectInfo.repoOwner || !projectInfo.repoName) {
        // No GitHub repo — stop watching
        if (commitWatcher) {
            commitWatcher.stop();
            commitWatcher = null;
        }
        return;
    }

    if (!commitWatcher) {
        commitWatcher = new CommitWatcher();
    }

    commitWatcher.start(
        projectInfo,
        dashboard.projectExistsRemotely,
        () => {
            void vscode.commands.executeCommand('deploymentManager.deployProject');
        },
        () => {
            void vscode.commands.executeCommand('deploymentManager.redeployProject');
        }
    );
}

/**
 * Extension deactivation.
 */
export function deactivate(): void {
    if (commitWatcher) {
        commitWatcher.stop();
        commitWatcher = null;
    }
}
