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
exports.deployProject = deployProject;
const vscode = __importStar(require("vscode"));
const projectDetector_1 = require("../services/projectDetector");
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
const providers_1 = require("../providers");
const PROVIDER_CONNECTION_KEYS = {
    Vercel: types_1.StorageKeys.VERCEL_TOKEN,
    Coolify: types_1.StorageKeys.COOLIFY_TOKEN,
    Netlify: types_1.StorageKeys.NETLIFY_TOKEN,
};
/**
 * Deploy a project that does not yet exist remotely.
 * Enforces the "deploy only if new" rule.
 */
async function deployProject(dashboardRefresh) {
    const detector = new projectDetector_1.ProjectDetector();
    const projectInfo = await detector.detect();
    if (!projectInfo) {
        vscode.window.showErrorMessage('No workspace folder is open. Please open a project first.');
        return;
    }
    const storage = secretStorage_1.SecretStorageManager.getInstance();
    const connectedProviders = [];
    for (const providerName of Object.keys(PROVIDER_CONNECTION_KEYS)) {
        if (await storage.has(PROVIDER_CONNECTION_KEYS[providerName])) {
            connectedProviders.push(providerName);
        }
    }
    if (connectedProviders.length === 0) {
        vscode.window.showErrorMessage('No deployment providers connected. Please connect Vercel, Coolify, or Netlify first.');
        return;
    }
    const existingProviders = [];
    for (const providerName of connectedProviders) {
        const adapter = (0, providers_1.getProvider)(providerName);
        const existing = await adapter.findExistingProject(projectInfo);
        if (existing) {
            existingProviders.push(providerName);
        }
    }
    if (existingProviders.length > 0) {
        const list = existingProviders.join(', ');
        vscode.window.showWarningMessage(`Project "${projectInfo.name}" already exists on ${list}. Use Redeploy instead.`);
        return;
    }
    const selected = await vscode.window.showQuickPick(connectedProviders.map((provider) => ({
        label: provider,
        description: `Deploy to ${provider}`,
    })), {
        placeHolder: 'Select deployment provider',
        ignoreFocusOut: true,
    });
    if (!selected) {
        return;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Deploying ${projectInfo.name} to ${selected.label}...`,
        cancellable: false,
    }, async () => {
        try {
            const provider = selected.label;
            const adapter = (0, providers_1.getProvider)(provider);
            await adapter.createProject(projectInfo);
            vscode.window.showInformationMessage(`Project "${projectInfo.name}" created on ${provider}.`);
            dashboardRefresh();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Deployment failed: ${message}`);
        }
    });
}
//# sourceMappingURL=deployProject.js.map