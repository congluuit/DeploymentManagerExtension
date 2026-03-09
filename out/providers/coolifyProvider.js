"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coolifyProvider = void 0;
const coolifyClient_1 = require("../clients/coolifyClient");
const POLL_INTERVAL_MS = 4000;
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;
class CoolifyProviderAdapter {
    constructor() {
        this.provider = 'Coolify';
    }
    async findExistingProject(project) {
        const client = new coolifyClient_1.CoolifyClient();
        const existing = await client.findApplicationByNameOrRepo(project.name, project.repoUrl);
        return existing ? { id: existing.uuid, name: existing.name } : null;
    }
    async createProject(project) {
        const client = new coolifyClient_1.CoolifyClient();
        await client.createApplication({
            name: project.name,
            git_repository: project.repoUrl || undefined,
            git_branch: project.branch,
        });
    }
    async listProjects() {
        const client = new coolifyClient_1.CoolifyClient();
        const apps = await client.listApplications();
        return apps.map((app) => ({ id: app.uuid, name: app.name }));
    }
    async getLogs(projectId) {
        const client = new coolifyClient_1.CoolifyClient();
        const logs = await client.getApplicationLogs(projectId);
        return logs || 'No logs available for this application.';
    }
    async redeploy(target, context) {
        const client = new coolifyClient_1.CoolifyClient();
        context.progress.report({ message: 'Triggering redeploy request...' });
        await client.deployApplication(target.id);
        context.progress.report({ message: 'Redeploy triggered. Waiting for Coolify status...' });
        await this.waitForDeployment(client, target.id, target.name, context.progress);
        return {};
    }
    async waitForDeployment(client, appId, appName, progress) {
        const startedAt = Date.now();
        let sawNonSuccessState = false;
        while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
            const application = await client.getApplication(appId);
            const rawStatus = application.status || 'unknown';
            const status = rawStatus.toLowerCase();
            progress.report({
                message: `Coolify status: ${rawStatus} (${this.formatElapsed(startedAt)})`,
            });
            if (!this.isSuccessStatus(status)) {
                sawNonSuccessState = true;
            }
            if (this.isFailureStatus(status)) {
                const logReason = await this.extractFailureReason(client, appId);
                throw new Error(`Coolify deployment failed for "${appName}" with status "${rawStatus}". ${logReason}`);
            }
            if (this.isSuccessStatus(status)) {
                if (sawNonSuccessState || Date.now() - startedAt >= 10000) {
                    return;
                }
            }
            await this.sleep(POLL_INTERVAL_MS);
        }
        throw new Error(`Timed out waiting for Coolify deployment to complete for "${appName}".`);
    }
    async extractFailureReason(client, appId) {
        try {
            const logs = await client.getApplicationLogs(appId);
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
            // Best effort only.
        }
        return 'No detailed failure log was returned by Coolify.';
    }
    isSuccessStatus(status) {
        return ['running', 'ready', 'healthy', 'active', 'started', 'up'].includes(status);
    }
    isFailureStatus(status) {
        return ['failed', 'error', 'errored', 'crashed', 'dead', 'unhealthy', 'stopped', 'exited'].includes(status);
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
exports.coolifyProvider = new CoolifyProviderAdapter();
//# sourceMappingURL=coolifyProvider.js.map