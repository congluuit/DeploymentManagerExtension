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
const POLL_INTERVAL_MS = 4000;
const VERCEL_TIMEOUT_MS = 15 * 60 * 1000;
const COOLIFY_TIMEOUT_MS = 15 * 60 * 1000;
/**
 * Redeploy an existing project.
 * Enforces the "redeploy only if already exists" rule.
 */
async function redeployProject(dashboardRefresh, options) {
    const notify = options?.notify ?? true;
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
    const hasVercel = await storage.has(types_1.StorageKeys.VERCEL_TOKEN);
    const hasCoolify = await storage.has(types_1.StorageKeys.COOLIFY_TOKEN);
    if (!hasVercel && !hasCoolify) {
        const message = 'No deployment providers connected. Please connect Vercel or Coolify first.';
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }
    const foundProviders = options?.target
        ? [{ provider: options.target.provider, id: options.target.id, name: options.target.name }]
        : [];
    if (!options?.target && hasVercel) {
        const vercel = new vercelClient_1.VercelClient();
        const existing = await vercel.findProjectByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            foundProviders.push({ provider: 'Vercel', id: existing.id, name: existing.name });
        }
    }
    if (!options?.target && hasCoolify) {
        const coolify = new coolifyClient_1.CoolifyClient();
        const existing = await coolify.findApplicationByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            foundProviders.push({ provider: 'Coolify', id: existing.uuid, name: existing.name });
        }
    }
    if (foundProviders.length === 0) {
        const message = `Project "${projectInfo.name}" does not exist on any connected provider. Use Deploy instead.`;
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
    if (target.provider === 'Vercel' && !hasVercel) {
        const message = 'Vercel is not connected. Please connect Vercel first.';
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }
    if (target.provider === 'Coolify' && !hasCoolify) {
        const message = 'Coolify is not connected. Please connect Coolify first.';
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
            if (target.provider === 'Vercel') {
                const vercel = new vercelClient_1.VercelClient();
                progress.report({ message: 'Triggering redeploy request...' });
                const deployment = await vercel.redeployProject(target.id, target.name);
                const deploymentId = deployment.uid || deployment.id;
                if (!deploymentId) {
                    throw new Error('Unable to determine Vercel deployment ID after triggering redeploy.');
                }
                progress.report({ message: `Queued deployment ${shortId(deploymentId)}. Waiting for build status...` });
                const completed = await waitForVercelDeployment(vercel, deploymentId, target.name, progress);
                const deploymentUrl = completed.url ? `https://${completed.url}` : null;
                if (notify) {
                    vscode.window.showInformationMessage(deploymentUrl
                        ? `Redeployment succeeded for "${target.name}" on Vercel. URL: ${deploymentUrl}`
                        : `Redeployment succeeded for "${target.name}" on Vercel.`);
                }
            }
            else {
                const coolify = new coolifyClient_1.CoolifyClient();
                progress.report({ message: 'Triggering redeploy request...' });
                await coolify.deployApplication(target.id);
                progress.report({ message: 'Redeploy triggered. Waiting for Coolify status...' });
                await waitForCoolifyDeployment(coolify, target.id, target.name, progress);
                if (notify) {
                    vscode.window.showInformationMessage(`Redeployment succeeded for "${target.name}" on Coolify.`);
                }
            }
            dashboardRefresh();
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
async function waitForVercelDeployment(vercel, deploymentId, projectName, progress) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < VERCEL_TIMEOUT_MS) {
        try {
            const deployment = await vercel.getDeployment(deploymentId);
            const state = getVercelState(deployment);
            progress.report({
                message: `Vercel status: ${state} (${formatElapsed(startedAt)})`,
            });
            if (state === 'READY') {
                return {
                    state,
                    url: typeof deployment.url === 'string' ? deployment.url : undefined,
                };
            }
            if (state === 'ERROR' || state === 'CANCELED') {
                const reason = extractVercelFailureReason(deployment) || 'No failure reason returned by Vercel.';
                throw new Error(`Vercel deployment failed (${state}) for "${projectName}": ${reason}`);
            }
        }
        catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            // Vercel may briefly return 404 right after create; retry early.
            if (Date.now() - startedAt < 30000 && /404|not found/i.test(text)) {
                progress.report({ message: `Waiting for deployment details... (${formatElapsed(startedAt)})` });
                await sleep(POLL_INTERVAL_MS);
                continue;
            }
            throw error;
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timed out waiting for Vercel deployment to complete for "${projectName}".`);
}
async function waitForCoolifyDeployment(coolify, appId, appName, progress) {
    const startedAt = Date.now();
    let sawNonSuccessState = false;
    while (Date.now() - startedAt < COOLIFY_TIMEOUT_MS) {
        const application = await coolify.getApplication(appId);
        const rawStatus = application.status || 'unknown';
        const status = rawStatus.toLowerCase();
        progress.report({
            message: `Coolify status: ${rawStatus} (${formatElapsed(startedAt)})`,
        });
        if (!isCoolifySuccessStatus(status)) {
            sawNonSuccessState = true;
        }
        if (isCoolifyFailureStatus(status)) {
            const logReason = await extractCoolifyFailureReason(coolify, appId);
            throw new Error(`Coolify deployment failed for "${appName}" with status "${rawStatus}". ${logReason}`);
        }
        if (isCoolifySuccessStatus(status)) {
            // Avoid instant false-positive when status still shows previous "running" state.
            if (sawNonSuccessState || Date.now() - startedAt >= 10000) {
                return;
            }
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timed out waiting for Coolify deployment to complete for "${appName}".`);
}
function getVercelState(deployment) {
    const state = deployment.state ?? deployment.readyState ?? 'QUEUED';
    return String(state).toUpperCase();
}
function extractVercelFailureReason(deployment) {
    const error = deployment.error;
    const meta = deployment.meta;
    const candidates = [
        error?.message,
        deployment.errorMessage,
        deployment.readyStateReason,
        meta?.error,
        meta?.errorMessage,
        meta?.message,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim();
        }
    }
    return null;
}
function isCoolifySuccessStatus(status) {
    return ['running', 'ready', 'healthy', 'active', 'started', 'up'].includes(status);
}
function isCoolifyFailureStatus(status) {
    return ['failed', 'error', 'errored', 'crashed', 'dead', 'unhealthy', 'stopped', 'exited'].includes(status);
}
async function extractCoolifyFailureReason(coolify, appId) {
    try {
        const logs = await coolify.getApplicationLogs(appId);
        const lastLine = logs
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(-1)[0];
        if (lastLine) {
            return `Last log line: ${lastLine}`;
        }
    }
    catch {
        // Best-effort logs only.
    }
    return 'No detailed failure log was returned by Coolify.';
}
function shortId(id) {
    return id.length <= 8 ? id : id.slice(0, 8);
}
function formatElapsed(startedAt) {
    const totalSeconds = Math.floor((Date.now() - startedAt) / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=redeployProject.js.map