"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vercelProvider = void 0;
exports.getLatestVercelDeploymentMeta = getLatestVercelDeploymentMeta;
const child_process_1 = require("child_process");
const vercelClient_1 = require("../clients/vercelClient");
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
const POLL_INTERVAL_MS = 4000;
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;
class VercelProviderAdapter {
    constructor() {
        this.provider = 'Vercel';
    }
    async findExistingProject(project) {
        const client = new vercelClient_1.VercelClient();
        const existing = await client.findProjectByNameOrRepo(project.name, project.repoUrl);
        return existing ? { id: existing.id, name: existing.name } : null;
    }
    async createProject(project) {
        const client = new vercelClient_1.VercelClient();
        const gitRepo = project.repoOwner && project.repoName
            ? { type: 'github', repo: `${project.repoOwner}/${project.repoName}` }
            : undefined;
        const created = await client.createProject(project.name, gitRepo);
        const deployment = await client.deployProjectFromGit(created.id, created.name, {
            branch: project.branch,
            target: 'production',
        });
        const deploymentId = deployment.uid || deployment.id;
        if (!deploymentId) {
            throw new Error('Vercel did not return a deployment ID after creating the project.');
        }
        const silentProgress = {
            report: () => undefined,
        };
        await this.waitForDeployment(client, deploymentId, created.name, silentProgress);
    }
    async listProjects() {
        const client = new vercelClient_1.VercelClient();
        const projects = await client.listProjects();
        return projects.map((project) => ({ id: project.id, name: project.name }));
    }
    async getLogs(projectId) {
        const client = new vercelClient_1.VercelClient();
        const deployments = await client.listDeployments(projectId, 5);
        if (deployments.length === 0) {
            return 'No deployments found for this project.';
        }
        const lines = [];
        for (const deployment of deployments) {
            const date = new Date((deployment.createdAt ?? deployment.created ?? Date.now()) > 10000000000
                ? (deployment.createdAt ?? deployment.created ?? Date.now())
                : (deployment.createdAt ?? deployment.created ?? Date.now()) * 1000).toLocaleString();
            lines.push(`--- Deployment ${deployment.uid.substring(0, 8)} ---`);
            lines.push(`  URL:     ${deployment.url || 'N/A'}`);
            lines.push(`  State:   ${this.getState(deployment)}`);
            lines.push(`  Created: ${date}`);
            lines.push(`  Source:  ${deployment.source || 'N/A'}`);
            lines.push('');
        }
        return lines.join('\n');
    }
    async redeploy(target, context) {
        if (!context.projectPath) {
            throw new Error('Workspace folder is required to run Vercel CLI deploy.');
        }
        const rawToken = await secretStorage_1.SecretStorageManager.getInstance().get(types_1.StorageKeys.VERCEL_TOKEN);
        const token = rawToken?.trim().replace(/^['"]+|['"]+$/g, '');
        if (!token) {
            throw new Error('Vercel API token not found.');
        }
        this.reportStatus(context, {
            phase: 'info',
            message: 'Starting Vercel CLI deploy...',
            sourceLabel: '>_ vercel deploy',
        });
        return new Promise((resolve, reject) => {
            const isWin = process.platform === 'win32';
            const command = `npx --yes vercel@latest deploy --prod --yes --token ${token}`;
            const child = isWin
                ? (0, child_process_1.spawn)('cmd.exe', ['/d', '/s', '/c', command], { cwd: context.projectPath, windowsHide: true })
                : (0, child_process_1.spawn)('npx', ['--yes', 'vercel@latest', 'deploy', '--prod', '--yes', '--token', token], {
                    cwd: context.projectPath,
                });
            let combinedOutput = '';
            let deploymentUrl;
            let hasReportedUploading = false;
            let hasReportedDeploying = false;
            child.stdout.on('data', (data) => {
                const text = data.toString();
                combinedOutput += text;
                const urlMatch = text.match(/https:\/\/[^\s]+\.vercel\.app/);
                if (urlMatch) {
                    deploymentUrl = urlMatch[0].trim();
                }
                if (!hasReportedUploading) {
                    hasReportedUploading = true;
                    this.reportStatus(context, {
                        phase: 'uploading',
                        message: 'Uploading files...',
                        sourceLabel: '>_ vercel deploy',
                    });
                }
            });
            child.stderr.on('data', (data) => {
                const text = data.toString();
                combinedOutput += text;
                if (!hasReportedDeploying) {
                    hasReportedDeploying = true;
                    this.reportStatus(context, {
                        phase: 'deploying',
                        message: 'Building deployment...',
                        sourceLabel: '>_ vercel deploy',
                    });
                }
            });
            child.on('close', (code) => {
                if (code === 0) {
                    this.reportStatus(context, {
                        phase: 'ready',
                        message: 'Deployment ready.',
                        sourceLabel: '>_ vercel deploy',
                    });
                    if (!deploymentUrl) {
                        const allUrls = combinedOutput.match(/https:\/\/[^\s]+\.vercel\.app/g);
                        if (allUrls && allUrls.length > 0) {
                            deploymentUrl = allUrls[allUrls.length - 1];
                        }
                    }
                    resolve({ deploymentUrl });
                }
                else {
                    const compactOutput = combinedOutput.replace(/\r/g, '').trim();
                    const maxErrorChars = 5000;
                    const clipped = compactOutput.length > maxErrorChars
                        ? `...[truncated]\n${compactOutput.slice(compactOutput.length - maxErrorChars)}`
                        : compactOutput;
                    reject(new Error(`Vercel CLI exited with code ${code}. Output: ${clipped}`));
                }
            });
            child.on('error', (err) => {
                reject(new Error(`Failed to start Vercel CLI: ${err.message}`));
            });
        });
    }
    async waitForDeployment(client, deploymentId, projectName, progress, onStatus) {
        const startedAt = Date.now();
        let lastEmittedSignature = '';
        while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
            try {
                const deployment = await client.getDeployment(deploymentId);
                const events = await this.getDeploymentEventsSafe(client, deploymentId);
                const state = this.getState(deployment);
                const statusUpdate = this.buildStatusUpdate(deployment, events);
                const signature = `${statusUpdate.phase}|${statusUpdate.state ?? ''}|${statusUpdate.message}|${statusUpdate.sourceLabel ?? ''}`;
                if (signature !== lastEmittedSignature) {
                    lastEmittedSignature = signature;
                    progress.report({
                        message: `${statusUpdate.message} (${this.formatElapsed(startedAt)})`,
                    });
                    onStatus?.({
                        ...statusUpdate,
                        timestamp: Date.now(),
                    });
                }
                if (state === 'READY') {
                    return deployment;
                }
                if (state === 'ERROR' || state === 'CANCELED') {
                    const reason = this.extractFailureReason(deployment, events) || 'No failure reason returned by Vercel.';
                    throw new Error(`Vercel deployment failed (${state}) for "${projectName}": ${reason}`);
                }
            }
            catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                const elapsedMs = Date.now() - startedAt;
                if (elapsedMs < 30000 && /404|not found/i.test(text)) {
                    const message = `Waiting for deployment details... (${this.formatElapsed(startedAt)})`;
                    progress.report({ message });
                    onStatus?.({
                        phase: 'queued',
                        state: 'QUEUED',
                        message: 'Waiting for deployment details...',
                        timestamp: Date.now(),
                    });
                    await this.sleep(POLL_INTERVAL_MS);
                    continue;
                }
                if (this.isTransientPollingError(text)) {
                    const message = `Temporary Vercel API issue. Retrying... (${this.formatElapsed(startedAt)})`;
                    progress.report({ message });
                    onStatus?.({
                        phase: 'info',
                        message: 'Temporary Vercel API/network issue. Retrying status check...',
                        timestamp: Date.now(),
                    });
                    await this.sleep(POLL_INTERVAL_MS);
                    continue;
                }
                throw error;
            }
            await this.sleep(POLL_INTERVAL_MS);
        }
        throw new Error(`Timed out waiting for Vercel deployment to complete for "${projectName}".`);
    }
    reportStatus(context, update) {
        context.progress.report({ message: update.message });
        context.onStatus?.({
            ...update,
            timestamp: Date.now(),
        });
    }
    getState(deployment) {
        const state = deployment.state ?? deployment.readyState ?? 'QUEUED';
        return String(state).toUpperCase();
    }
    async getDeploymentEventsSafe(client, deploymentId) {
        try {
            return await client.getDeploymentEvents(deploymentId, { limit: 80, direction: 'backward' });
        }
        catch {
            return [];
        }
    }
    buildStatusUpdate(deployment, events) {
        const state = this.getState(deployment);
        const sourceLabel = this.extractSourceLabel(deployment);
        const recentEvents = this.getRecentEvents(events);
        const uploadProgress = this.extractUploadProgress(recentEvents);
        if (uploadProgress) {
            return {
                phase: 'uploading',
                state,
                message: `Uploading... ${uploadProgress.uploaded}/${uploadProgress.total} files`,
                fileProgress: uploadProgress,
                sourceLabel,
            };
        }
        if (this.hasUploadEvent(recentEvents)) {
            return {
                phase: 'uploading',
                state,
                message: 'Uploading files...',
                sourceLabel,
            };
        }
        if (deployment.isInSystemBuildsQueue || deployment.isInConcurrentBuildsQueue || state === 'QUEUED') {
            return {
                phase: 'queued',
                state,
                message: 'Queued in Vercel build queue...',
                sourceLabel,
            };
        }
        if (state === 'INITIALIZING') {
            return {
                phase: 'deploying',
                state,
                message: 'Initializing deployment...',
                sourceLabel,
            };
        }
        if (state === 'BUILDING') {
            return {
                phase: 'deploying',
                state,
                message: 'Deploying...',
                sourceLabel,
            };
        }
        if (state === 'READY') {
            return {
                phase: 'ready',
                state,
                message: 'Deployment ready.',
                sourceLabel,
            };
        }
        if (state === 'ERROR' || state === 'CANCELED') {
            return {
                phase: 'failed',
                state,
                message: `Deployment ${state.toLowerCase()}.`,
                sourceLabel,
            };
        }
        return {
            phase: 'info',
            state,
            message: `Vercel status: ${state}`,
            sourceLabel,
        };
    }
    extractSourceLabel(deployment) {
        const creator = deployment.creator;
        const meta = deployment.meta ?? {};
        const candidates = [
            creator?.githubLogin,
            creator?.username,
            meta.githubCommitAuthorLogin,
            meta.githubCommitAuthorName,
            creator?.email,
            deployment.source,
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return `From ${candidate.trim()}`;
            }
        }
        return undefined;
    }
    extractFailureReason(deployment, events) {
        const meta = deployment.meta;
        const candidates = [
            deployment.errorMessage,
            deployment.readyStateReason,
            deployment.errorCode,
            meta?.error,
            meta?.errorMessage,
            meta?.message,
            this.extractLastEventText(events, /(error|fail|panic|exception|fatal)/i),
            this.extractLastEventText(events),
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }
        return null;
    }
    extractUploadProgress(events) {
        for (const event of events) {
            const text = this.extractEventText(event);
            if (!text) {
                continue;
            }
            const match = text.match(/(\d+)\s*\/\s*(\d+)\s*files?/i);
            if (match) {
                const uploaded = Number(match[1]);
                const total = Number(match[2]);
                if (Number.isFinite(uploaded) && Number.isFinite(total) && total > 0) {
                    return { uploaded, total };
                }
            }
        }
        return null;
    }
    hasUploadEvent(events) {
        return events.some((event) => /upload/i.test(this.extractEventText(event) ?? ''));
    }
    getRecentEvents(events) {
        return [...events]
            .sort((a, b) => {
            const aTime = typeof a.createdAt === 'number' ? a.createdAt : 0;
            const bTime = typeof b.createdAt === 'number' ? b.createdAt : 0;
            return bTime - aTime;
        })
            .slice(0, 8);
    }
    extractLastEventText(events, pattern) {
        for (const event of events) {
            const text = this.extractEventText(event);
            if (!text) {
                continue;
            }
            if (!pattern || pattern.test(text)) {
                return text;
            }
        }
        return null;
    }
    extractEventText(event) {
        const payloadText = this.extractTextFromUnknown(event.payload);
        const infoText = this.extractTextFromUnknown(event.info);
        const rootText = this.extractTextFromUnknown(event);
        const text = payloadText || infoText || rootText;
        if (!text) {
            return null;
        }
        return text.replace(/\s+/g, ' ').trim();
    }
    extractTextFromUnknown(value) {
        if (!value) {
            return null;
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value !== 'object') {
            return null;
        }
        const preferredKeys = ['text', 'message', 'error', 'detail', 'status', 'name', 'type', 'reason'];
        const source = value;
        for (const key of preferredKeys) {
            const candidate = source[key];
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate;
            }
        }
        for (const candidate of Object.values(source)) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate;
            }
        }
        return null;
    }
    isTransientPollingError(message) {
        return /(fetch failed|network|timed out|timeout|econnreset|enotfound|eai_again|socket|und_err|429|503|504)/i.test(message);
    }
    formatElapsed(startedAt) {
        const totalSeconds = Math.floor((Date.now() - startedAt) / 1000);
        if (totalSeconds < 60) {
            return `${totalSeconds}s`;
        }
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.vercelProvider = new VercelProviderAdapter();
function getLatestVercelDeploymentMeta(deployment) {
    if (!deployment) {
        return { sha: null, timestamp: 0 };
    }
    const sha = extractCommitSha(deployment.meta);
    const raw = deployment.createdAt ?? deployment.created ?? 0;
    const timestamp = raw > 10000000000 ? raw : raw * 1000;
    return { sha, timestamp };
}
function extractCommitSha(meta) {
    if (!meta) {
        return null;
    }
    const directKeys = ['githubCommitSha', 'githubCommitHash', 'githubCommitRef', 'githubCommit'];
    for (const key of directKeys) {
        const value = meta[key];
        if (value && value.length >= 7) {
            return value.toLowerCase();
        }
    }
    for (const value of Object.values(meta)) {
        const match = value.match(/[0-9a-f]{40}/i);
        if (match) {
            return match[0].toLowerCase();
        }
    }
    return null;
}
//# sourceMappingURL=vercelProvider.js.map