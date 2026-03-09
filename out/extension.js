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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const secretStorage_1 = require("./utils/secretStorage");
const dashboardProvider_1 = require("./views/dashboardProvider");
const dashboardLauncherProvider_1 = require("./views/dashboardLauncherProvider");
const dashboardPanel_1 = require("./views/dashboardPanel");
const commitWatcher_1 = require("./services/commitWatcher");
const connectProvider_1 = require("./commands/connectProvider");
const deployProject_1 = require("./commands/deployProject");
const redeployProject_1 = require("./commands/redeployProject");
const refreshProjects_1 = require("./commands/refreshProjects");
const openLogs_1 = require("./commands/openLogs");
let commitWatcher = null;
/**
 * Extension activation entry point.
 * Called automatically when Antigravity starts (onStartupFinished).
 */
function activate(context) {
    console.log('Deployment Manager extension is now active!');
    // Initialize secure storage
    secretStorage_1.SecretStorageManager.initialize(context.secrets);
    // Keep the existing data provider for refresh + commit watcher data.
    const dashboardProvider = new dashboardProvider_1.DashboardProvider();
    // Sidebar now acts as a launcher; full dashboard opens in a closeable tab.
    const launcherProvider = new dashboardLauncherProvider_1.DashboardLauncherProvider();
    const treeView = vscode.window.createTreeView('deploymentManagerDashboard', {
        treeDataProvider: launcherProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);
    let skipFirstVisibilityEvent = treeView.visible;
    context.subscriptions.push(treeView.onDidChangeVisibility((event) => {
        if (skipFirstVisibilityEvent) {
            skipFirstVisibilityEvent = false;
            return;
        }
        if (event.visible) {
            void vscode.commands.executeCommand('deploymentManager.openDashboard');
        }
    }));
    // Create the refresh callback
    const doRefresh = async () => {
        await dashboardProvider.refresh();
        updateCommitWatcher(dashboardProvider);
        dashboardPanel_1.DashboardPanel.refreshCurrentPanel();
    };
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('deploymentManager.openDashboard', async () => {
        dashboardPanel_1.DashboardPanel.createOrShow(context.extensionUri, doRefresh);
        await doRefresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('deploymentManager.connectVercel', async () => {
        const success = await (0, connectProvider_1.connectVercel)();
        if (success) {
            await doRefresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('deploymentManager.connectCoolify', async () => {
        const success = await (0, connectProvider_1.connectCoolify)();
        if (success) {
            await doRefresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('deploymentManager.deployProject', async () => {
        await (0, deployProject_1.deployProject)(doRefresh);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('deploymentManager.redeployProject', async () => {
        await (0, redeployProject_1.redeployProject)(doRefresh);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('deploymentManager.refreshProjects', async () => {
        await (0, refreshProjects_1.refreshProjects)(doRefresh);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('deploymentManager.openLogs', async (item) => {
        if (item?.meta) {
            await (0, openLogs_1.openLogs)(item.meta.provider, item.meta.projectId, item.meta.projectName);
        }
        else {
            await (0, openLogs_1.openLogs)();
        }
    }));
    // Initial refresh — preload state for commit watcher and dashboard.
    void doRefresh();
}
/**
 * Start or update the commit watcher based on current dashboard state.
 */
function updateCommitWatcher(dashboard) {
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
        commitWatcher = new commitWatcher_1.CommitWatcher();
    }
    commitWatcher.start(projectInfo, dashboard.projectExistsRemotely, () => {
        void vscode.commands.executeCommand('deploymentManager.deployProject');
    }, () => {
        void vscode.commands.executeCommand('deploymentManager.redeployProject');
    });
}
/**
 * Extension deactivation.
 */
function deactivate() {
    if (commitWatcher) {
        commitWatcher.stop();
        commitWatcher = null;
    }
}
//# sourceMappingURL=extension.js.map