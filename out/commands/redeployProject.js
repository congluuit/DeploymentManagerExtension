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
const projectDetector_1 = require("../services/projectDetector");
const providers_1 = require("../providers");
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
const PROVIDER_CONNECTION_KEYS = {
    Vercel: types_1.StorageKeys.VERCEL_TOKEN,
    Coolify: types_1.StorageKeys.COOLIFY_TOKEN,
    Netlify: types_1.StorageKeys.NETLIFY_TOKEN,
};
/**
 * Redeploy an existing project.
 * Enforces the "redeploy only if already exists" rule.
 */
async function redeployProject(dashboardRefresh, options) {
    const notify = options?.notify ?? true;
    const refreshDashboard = options?.refreshDashboard ?? true;
    const detector = new projectDetector_1.ProjectDetector();
    const projectInfo = options?.target ? null : await detector.detect();
    if (!projectInfo && !options?.target) {
        const message = 'No workspace folder is open. Please open a project first.';
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }
    const storage = secretStorage_1.SecretStorageManager.getInstance();
    const connectedProviders = [];
    for (const providerName of Object.keys(PROVIDER_CONNECTION_KEYS)) {
        if (await storage.has(PROVIDER_CONNECTION_KEYS[providerName])) {
            connectedProviders.push(providerName);
        }
    }
    if (connectedProviders.length === 0) {
        const message = 'No deployment providers connected. Please connect Vercel, Coolify, or Netlify first.';
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }
    const foundProviders = options?.target
        ? [{ provider: options.target.provider, id: options.target.id, name: options.target.name }]
        : [];
    if (!options?.target && projectInfo) {
        for (const providerName of connectedProviders) {
            const adapter = (0, providers_1.getProvider)(providerName);
            const existing = await adapter.findExistingProject(projectInfo);
            if (existing) {
                foundProviders.push({ provider: providerName, id: existing.id, name: existing.name });
            }
        }
    }
    if (foundProviders.length === 0) {
        const projectName = projectInfo?.name || options?.target?.name || 'Current project';
        const message = `Project "${projectName}" does not exist on any connected provider. Use Deploy instead.`;
        if (notify) {
            vscode.window.showWarningMessage(message);
        }
        return { success: false, error: message };
    }
    let target;
    if (options?.target || foundProviders.length === 1) {
        target = foundProviders[0];
    }
    else {
        const picked = await vscode.window.showQuickPick(foundProviders.map((provider) => ({
            label: provider.provider,
            description: `Redeploy "${provider.name}" on ${provider.provider}`,
            provider,
        })), { placeHolder: 'Select provider to redeploy on', ignoreFocusOut: true });
        if (!picked) {
            return { success: false, error: 'Redeploy canceled.' };
        }
        target = picked.provider;
    }
    const isConnected = connectedProviders.includes(target.provider);
    if (!isConnected) {
        const message = `${target.provider} is not connected. Please connect ${target.provider} first.`;
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }
    let runError = null;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Redeploying ${target.name} on ${target.provider}...`,
        cancellable: false,
    }, async (progress) => {
        try {
            const adapter = (0, providers_1.getProvider)(target.provider);
            const result = await adapter.redeploy({ id: target.id, name: target.name }, { progress });
            if (notify) {
                const urlSuffix = result.deploymentUrl ? ` URL: ${result.deploymentUrl}` : '';
                vscode.window.showInformationMessage(`Redeployment succeeded for "${target.name}" on ${target.provider}.${urlSuffix}`);
            }
            if (refreshDashboard) {
                await Promise.resolve(dashboardRefresh());
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            runError = message;
            if (notify) {
                vscode.window.showErrorMessage(`Redeployment failed: ${message}`);
            }
        }
    });
    if (runError) {
        return { success: false, error: runError };
    }
    return { success: true };
}
//# sourceMappingURL=redeployProject.js.map