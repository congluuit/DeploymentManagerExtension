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
exports.DashboardLauncherProvider = void 0;
const vscode = __importStar(require("vscode"));
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
class DashboardLauncherProvider {
    constructor() {
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return [];
        }
        const openDashboardItem = new DashboardLauncherItem();
        const hintItem = new vscode.TreeItem('Click the rocket icon any time to reopen the dashboard', vscode.TreeItemCollapsibleState.None);
        hintItem.id = 'deploymentManager.dashboardLauncher.hint';
        hintItem.iconPath = new vscode.ThemeIcon('lightbulb-autofix');
        hintItem.description = 'Dashboard tab can be closed when idle';
        return [openDashboardItem, hintItem];
    }
}
exports.DashboardLauncherProvider = DashboardLauncherProvider;
//# sourceMappingURL=dashboardLauncherProvider.js.map