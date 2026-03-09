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
            const date = new Date(deployment.createdAt ?? deployment.created).toLocaleString();
            lines.push(`--- Deployment ${deployment.uid.substring(0, 8)} ---`);
            lines.push(`  URL:     ${deployment.url || 'N/A'}`);
            lines.push(`  State:   ${deployment.state}`);
            lines.push(`  Created: ${date}`);
            lines.push(`  Source:  ${deployment.source || 'N/A'}`);
            lines.push('');
        }
        return lines.join('\n');
    }
    async redeploy(target, context) {
        const client = new vercelClient_1.VercelClient();
        context.progress.report({ message: 'Triggering redeploy request...' });
        const deployment = await client.redeployProject(target.id, target.name);
        const deploymentId = deployment.uid || deployment.id;
        if (!deploymentId) {
            throw new Error('Unable to determine Vercel deployment ID after triggering redeploy.');
        }
        context.progress.report({
            message: `Queued deployment ${deploymentId.slice(0, 8)}. Waiting for build status...`,
        });
        const completed = await this.waitForDeployment(client, deploymentId, target.name, context.progress);
        return { deploymentUrl: completed.url ? `https://${completed.url}` : undefined };
    }
    async waitForDeployment(client, deploymentId, projectName, progress) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
            try {
                const deployment = await client.getDeployment(deploymentId);
                const state = this.getState(deployment);
                progress.report({
                    message: `Vercel status: ${state} (${this.formatElapsed(startedAt)})`,
                });
                if (state === 'READY') {
                    return {
                        state,
                        url: typeof deployment.url === 'string' ? deployment.url : undefined,
                    };
                }
                if (state === 'ERROR' || state === 'CANCELED') {
                    const reason = this.extractFailureReason(deployment) || 'No failure reason returned by Vercel.';
                    throw new Error(`Vercel deployment failed (${state}) for "${projectName}": ${reason}`);
                }
            }
            catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                if (Date.now() - startedAt < 30000 && /404|not found/i.test(text)) {
                    progress.report({ message: `Waiting for deployment details... (${this.formatElapsed(startedAt)})` });
                    await this.sleep(POLL_INTERVAL_MS);
                    continue;
                }
                throw error;
            }
            await this.sleep(POLL_INTERVAL_MS);
        }
        throw new Error(`Timed out waiting for Vercel deployment to complete for "${projectName}".`);
    }
    getState(deployment) {
        const state = deployment.state ?? deployment.readyState ?? 'QUEUED';
        return String(state).toUpperCase();
    }
    extractFailureReason(deployment) {
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