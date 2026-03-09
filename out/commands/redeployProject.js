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
exports.redeployProject = redeployProject;
const vscode = __importStar(require("vscode"));
const vercelClient_1 = require("../clients/vercelClient");
const coolifyClient_1 = require("../clients/coolifyClient");
const projectDetector_1 = require("../services/projectDetector");
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
/**
 * Redeploy an existing project.
 * Enforces the "redeploy only if already exists" rule.
 */
async function redeployProject(dashboardRefresh) {
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
    const foundProviders = [];
    if (hasVercel) {
        const vercel = new vercelClient_1.VercelClient();
        const existing = await vercel.findProjectByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            foundProviders.push({ provider: 'Vercel', id: existing.id, name: existing.name });
        }
    }
    if (hasCoolify) {
        const coolify = new coolifyClient_1.CoolifyClient();
        const existing = await coolify.findApplicationByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            foundProviders.push({ provider: 'Coolify', id: existing.uuid, name: existing.name });
        }
    }
    if (foundProviders.length === 0) {
        vscode.window.showWarningMessage(`Project "${projectInfo.name}" does not exist on any connected provider. Use Deploy instead.`);
        return;
    }
    // If on multiple providers, let user pick
    let target;
    if (foundProviders.length === 1) {
        target = foundProviders[0];
    }
    else {
        const picked = await vscode.window.showQuickPick(foundProviders.map((p) => ({
            label: p.provider,
            description: `Redeploy "${p.name}" on ${p.provider}`,
            provider: p,
        })), { placeHolder: 'Select provider to redeploy on', ignoreFocusOut: true });
        if (!picked) {
            return;
        }
        target = picked.provider;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Redeploying ${target.name} on ${target.provider}...`,
        cancellable: false,
    }, async () => {
        try {
            if (target.provider === 'Vercel') {
                const vercel = new vercelClient_1.VercelClient();
                await vercel.createDeployment(target.name);
                vscode.window.showInformationMessage(`✅ Redeployment triggered for "${target.name}" on Vercel!`);
            }
            else if (target.provider === 'Coolify') {
                const coolify = new coolifyClient_1.CoolifyClient();
                await coolify.deployApplication(target.id);
                vscode.window.showInformationMessage(`✅ Redeployment triggered for "${target.name}" on Coolify!`);
            }
            dashboardRefresh();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`❌ Redeployment failed: ${message}`);
        }
    });
}
//# sourceMappingURL=redeployProject.js.map