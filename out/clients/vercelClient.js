"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VercelClient = void 0;
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
const VERCEL_API_BASE = 'https://api.vercel.com';
/**
 * Vercel REST API client.
 * Handles authentication and all project/deployment operations.
 */
class VercelClient {
    constructor() {
        this.secretStorage = secretStorage_1.SecretStorageManager.getInstance();
    }
    /** Get the stored API token. */
    async getToken() {
        const token = await this.secretStorage.get(types_1.StorageKeys.VERCEL_TOKEN);
        if (!token) {
            throw new Error('Vercel API token not configured. Please connect Vercel first.');
        }
        return token;
    }
    /** Build authorization headers. */
    async getHeaders() {
        const token = await this.getToken();
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };
    }
    /** Make an authenticated request to the Vercel API. */
    async request(method, path, body) {
        const headers = await this.getHeaders();
        const url = `${VERCEL_API_BASE}${path}`;
        const options = {
            method,
            headers,
        };
        if (body) {
            options.body = JSON.stringify(body);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Vercel API error (${response.status}): ${errorBody}`);
        }
        if (response.status === 204) {
            return undefined;
        }
        return response.json();
    }
    /** Check if the token is valid by listing projects. */
    async validateToken() {
        try {
            await this.request('GET', '/v9/projects?limit=1');
            return true;
        }
        catch {
            return false;
        }
    }
    /** Retrieve all projects. */
    async listProjects() {
        const result = await this.request('GET', '/v9/projects?limit=100');
        return result.projects;
    }
    /** Retrieve a single project by ID or name. */
    async getProject(idOrName) {
        return this.request('GET', `/v9/projects/${encodeURIComponent(idOrName)}`);
    }
    /** Create a new project. */
    async createProject(name, gitRepository) {
        const body = { name };
        if (gitRepository) {
            body.gitRepository = gitRepository;
        }
        return this.request('POST', '/v10/projects', body);
    }
    /** Delete a project by ID or name. */
    async deleteProject(idOrName) {
        await this.request('DELETE', `/v9/projects/${encodeURIComponent(idOrName)}`);
    }
    /** List deployments for a project. */
    async listDeployments(projectId, limit = 20) {
        const result = await this.request('GET', `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`);
        return result.deployments;
    }
    /** Create a new deployment. */
    async createDeployment(name, options) {
        const body = { name };
        if (options?.gitSource) {
            body.gitSource = options.gitSource;
        }
        if (options?.project) {
            body.project = options.project;
        }
        if (options?.deploymentId) {
            body.deploymentId = options.deploymentId;
        }
        if (typeof options?.withLatestCommit === 'boolean') {
            body.withLatestCommit = options.withLatestCommit;
        }
        if (options?.target) {
            body.target = options.target;
        }
        return this.request('POST', '/v13/deployments', body);
    }
    /** Redeploy an existing Vercel project by cloning its latest deployment. */
    async redeployProject(projectId, name) {
        const deployments = await this.listDeployments(projectId, 1);
        if (deployments.length === 0) {
            throw new Error(`No previous deployments found for project "${name}".`);
        }
        const latest = deployments[0];
        const deploymentId = latest.uid || latest.id;
        if (!deploymentId) {
            throw new Error(`Unable to determine latest deployment ID for project "${name}".`);
        }
        return this.createDeployment(name, {
            project: projectId,
            deploymentId,
            withLatestCommit: true,
        });
    }
    /** Get deployment details. */
    async getDeployment(deploymentId) {
        return this.request('GET', `/v13/deployments/${encodeURIComponent(deploymentId)}`);
    }
    /**
     * Check if a project exists by name or repo URL.
     * Returns the matched project or null.
     */
    async findProjectByNameOrRepo(name, repoUrl) {
        try {
            const projects = await this.listProjects();
            // Check by exact name match
            const byName = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
            if (byName) {
                return byName;
            }
            // Check by repo URL match
            if (repoUrl) {
                const normalizedUrl = this.normalizeRepoUrl(repoUrl);
                const byRepo = projects.find((p) => {
                    if (p.link?.repo) {
                        return this.normalizeRepoUrl(p.link.repo) === normalizedUrl;
                    }
                    return false;
                });
                if (byRepo) {
                    return byRepo;
                }
            }
            return null;
        }
        catch {
            return null;
        }
    }
    /** Normalize a repo URL for comparison. */
    normalizeRepoUrl(url) {
        return url
            .replace(/^https?:\/\//, '')
            .replace(/^git@github\.com:/, 'github.com/')
            .replace(/\.git$/, '')
            .toLowerCase();
    }
}
exports.VercelClient = VercelClient;
//# sourceMappingURL=vercelClient.js.map