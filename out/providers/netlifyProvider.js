"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.netlifyProvider = void 0;
const netlifyClient_1 = require("../clients/netlifyClient");
const POLL_INTERVAL_MS = 4000;
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;
class NetlifyProviderAdapter {
    constructor() {
        this.provider = 'Netlify';
    }
    async findExistingProject(project) {
        const client = new netlifyClient_1.NetlifyClient();
        const existing = await client.findSiteByNameOrRepo(project.name, project.repoUrl);
        return existing ? { id: existing.id, name: existing.name } : null;
    }
    async createProject(project) {
        const client = new netlifyClient_1.NetlifyClient();
        const repoPath = project.repoOwner && project.repoName ? `${project.repoOwner}/${project.repoName}` : undefined;
        await client.createSite({
            name: project.name,
            repo: repoPath
                ? {
                    provider: 'github',
                    repo_path: repoPath,
                    repo_url: project.repoUrl || `https://github.com/${repoPath}`,
                    repo_branch: project.branch,
                }
                : undefined,
        });
    }
    async listProjects() {
        const client = new netlifyClient_1.NetlifyClient();
        const sites = await client.listSites();
        return sites.map((site) => ({ id: site.id, name: site.name }));
    }
    async getLogs(projectId) {
        const client = new netlifyClient_1.NetlifyClient();
        const deploys = await client.listSiteDeploys(projectId, 5);
        if (deploys.length === 0) {
            return 'No deploys found for this site.';
        }
        const lines = [];
        for (const deploy of deploys) {
            const dateLabel = deploy.created_at
                ? new Date(deploy.created_at).toLocaleString()
                : 'Unknown';
            lines.push(`--- Deploy ${deploy.id.slice(0, 8)} ---`);
            lines.push(`  State:   ${deploy.state || 'unknown'}`);
            lines.push(`  Branch:  ${deploy.branch || 'N/A'}`);
            lines.push(`  Commit:  ${deploy.commit_ref || 'N/A'}`);
            lines.push(`  URL:     ${deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url || 'N/A'}`);
            lines.push(`  Created: ${dateLabel}`);
            if (deploy.error_message) {
                lines.push(`  Error:   ${deploy.error_message}`);
            }
            if (deploy.build_id) {
                try {
                    const build = await client.getBuild(deploy.build_id);
                    lines.push(`  Build:   ${build.id} | done=${String(build.done)} | sha=${build.sha || 'N/A'} | error=${build.error || 'N/A'}`);
                }
                catch {
                    lines.push(`  Build:   ${deploy.build_id} (details unavailable)`);
                }
            }
            lines.push('');
        }
        return lines.join('\n');
    }
    async redeploy(target, context) {
        const client = new netlifyClient_1.NetlifyClient();
        const beforeDeploy = (await client.listSiteDeploys(target.id, 1))[0] ?? null;
        context.progress.report({ message: 'Triggering redeploy request...' });
        await this.triggerBuild(client, target.id, target.name);
        context.progress.report({ message: 'Redeploy triggered. Waiting for Netlify status...' });
        const deploy = await this.waitForDeployment(client, target.id, target.name, beforeDeploy?.id ?? null, context.progress);
        return {
            deploymentUrl: deploy.deploy_ssl_url || deploy.ssl_url || deploy.deploy_url || deploy.url,
        };
    }
    async triggerBuild(client, siteId, siteName) {
        try {
            await client.createSiteBuild(siteId, {
                clear_cache: false,
                title: `Redeploy from Deployment Manager (${new Date().toISOString()})`,
            });
            return;
        }
        catch (buildError) {
            const site = await client.getSite(siteId);
            const branch = site.repo?.repo_branch || site.build_settings?.repo_branch;
            const hook = await this.getOrCreateBuildHook(client, siteId, site.deploy_hook, branch);
            if (!hook) {
                const message = buildError instanceof Error ? buildError.message : String(buildError);
                throw new Error(`Unable to trigger Netlify redeploy for "${siteName}". ${message}`);
            }
            await client.triggerBuildHook(hook.url);
        }
    }
    async getOrCreateBuildHook(client, siteId, siteDeployHook, branch) {
        if (siteDeployHook && siteDeployHook.trim().length > 0) {
            return { url: siteDeployHook };
        }
        const hooks = await client.listSiteBuildHooks(siteId);
        const existing = this.pickBestHook(hooks, branch);
        if (existing) {
            return { url: existing.url };
        }
        const created = await client.createSiteBuildHook(siteId, 'Deployment Manager Redeploy Hook', branch);
        return { url: created.url };
    }
    pickBestHook(hooks, branch) {
        if (hooks.length === 0) {
            return null;
        }
        if (branch) {
            const exact = hooks.find((hook) => hook.branch === branch && typeof hook.url === 'string');
            if (exact) {
                return exact;
            }
        }
        return hooks.find((hook) => typeof hook.url === 'string') ?? null;
    }
    async waitForDeployment(client, siteId, siteName, previousDeployId, progress) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
            const deploys = await client.listSiteDeploys(siteId, 5);
            const current = deploys.find((deploy) => deploy.id !== previousDeployId) ?? deploys[0];
            if (current) {
                const state = (current.state || 'unknown').toLowerCase();
                progress.report({
                    message: `Netlify status: ${current.state || 'unknown'} (${this.formatElapsed(startedAt)})`,
                });
                if (this.isSuccessState(state)) {
                    return current;
                }
                if (this.isFailureState(state)) {
                    const reason = current.error_message || 'No failure reason returned by Netlify.';
                    throw new Error(`Netlify deployment failed (${current.state}) for "${siteName}": ${reason}`);
                }
            }
            else {
                progress.report({
                    message: `Waiting for Netlify deployment to start... (${this.formatElapsed(startedAt)})`,
                });
            }
            await this.sleep(POLL_INTERVAL_MS);
        }
        throw new Error(`Timed out waiting for Netlify deployment to complete for "${siteName}".`);
    }
    isSuccessState(state) {
        return ['ready', 'processed'].includes(state);
    }
    isFailureState(state) {
        return ['error', 'rejected'].includes(state);
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
exports.netlifyProvider = new NetlifyProviderAdapter();
//# sourceMappingURL=netlifyProvider.js.map