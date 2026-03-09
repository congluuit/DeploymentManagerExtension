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
const vercelClient_1 = require("../clients/vercelClient");
const coolifyClient_1 = require("../clients/coolifyClient");
const projectDetector_1 = require("../services/projectDetector");
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
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
    const hasVercel = await storage.has(types_1.StorageKeys.VERCEL_TOKEN);
    const hasCoolify = await storage.has(types_1.StorageKeys.COOLIFY_TOKEN);
    if (!hasVercel && !hasCoolify) {
        vscode.window.showErrorMessage('No deployment providers connected. Please connect Vercel or Coolify first.');
        return;
    }
    // Check if project already exists remotely
    if (hasVercel) {
        const vercel = new vercelClient_1.VercelClient();
        const existing = await vercel.findProjectByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            vscode.window.showWarningMessage(`Project "${projectInfo.name}" already exists on Vercel. Use Redeploy instead.`);
            return;
        }
    }
    if (hasCoolify) {
        const coolify = new coolifyClient_1.CoolifyClient();
        const existing = await coolify.findApplicationByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            vscode.window.showWarningMessage(`Project "${projectInfo.name}" already exists on Coolify. Use Redeploy instead.`);
            return;
        }
    }
    // Build provider choices
    const providers = [];
    if (hasVercel) {
        providers.push({ label: 'Vercel', description: 'Deploy to Vercel' });
    }
    if (hasCoolify) {
        providers.push({ label: 'Coolify', description: 'Deploy to Coolify' });
    }
    const selected = await vscode.window.showQuickPick(providers, {
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
            if (selected.label === 'Vercel') {
                const vercel = new vercelClient_1.VercelClient();
                const gitRepo = projectInfo.repoOwner && projectInfo.repoName
                    ? { type: 'github', repo: `${projectInfo.repoOwner}/${projectInfo.repoName}` }
                    : undefined;
                await vercel.createProject(projectInfo.name, gitRepo);
                vscode.window.showInformationMessage(`✅ Project "${projectInfo.name}" created and deployed on Vercel!`);
            }
            else if (selected.label === 'Coolify') {
                const coolify = new coolifyClient_1.CoolifyClient();
                await coolify.createApplication({
                    name: projectInfo.name,
                    git_repository: projectInfo.repoUrl || undefined,
                    git_branch: projectInfo.branch,
                });
                vscode.window.showInformationMessage(`✅ Project "${projectInfo.name}" created and deployed on Coolify!`);
            }
            dashboardRefresh();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`❌ Deployment failed: ${message}`);
        }
    });
}
//# sourceMappingURL=deployProject.js.map