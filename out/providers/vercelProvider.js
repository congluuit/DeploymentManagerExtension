"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vercelProvider = void 0;
exports.getLatestVercelDeploymentMeta = getLatestVercelDeploymentMeta;
const vercelClient_1 = require("../clients/vercelClient");
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
        await client.createProject(project.name, gitRepo);
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
        const client = new vercelClient_1.VercelClient();
        this.reportStatus(context, {
            phase: 'info',
            message: 'Triggering Vercel redeploy request...',
        });
        const deployment = await client.redeployProject(target.id, target.name);
        const deploymentId = deployment.uid || deployment.id;
        if (!deploymentId) {
            throw new Error('Unable to determine Vercel deployment ID after triggering redeploy.');
        }
        this.reportStatus(context, {
            phase: 'queued',
            state: this.getState(deployment),
            message: `Queued deployment ${deploymentId.slice(0, 8)}. Waiting for Vercel status...`,
            sourceLabel: this.extractSourceLabel(deployment),
        });
        const completed = await this.waitForDeployment(client, deploymentId, target.name, context.progress, context.onStatus);
        this.reportStatus(context, {
            phase: 'ready',
            state: this.getState(completed),
            message: 'Finished. Deployment is ready.',
            sourceLabel: this.extractSourceLabel(completed),
        });
        return { deploymentUrl: completed.url ? `https://${completed.url}` : undefined };
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
                if (Date.now() - startedAt < 30000 && /404|not found/i.test(text)) {
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