"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetlifyClient = void 0;
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';
/**
 * Netlify REST API client.
 * Authenticates with a personal access token.
 */
class NetlifyClient {
    constructor() {
        this.secretStorage = secretStorage_1.SecretStorageManager.getInstance();
    }
    async getToken() {
        const token = await this.secretStorage.get(types_1.StorageKeys.NETLIFY_TOKEN);
        if (!token) {
            throw new Error('Netlify API token not configured. Please connect Netlify first.');
        }
        return token;
    }
    async getHeaders(hasBody) {
        const token = await this.getToken();
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
        };
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }
    async request(method, path, body) {
        const hasBody = body !== undefined;
        const headers = await this.getHeaders(hasBody);
        const url = `${NETLIFY_API_BASE}${path}`;
        const options = { method, headers };
        if (hasBody) {
            options.body = JSON.stringify(body);
        }
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Netlify API error (${response.status}): ${errorBody}`);
        }
        if (response.status === 204) {
            return undefined;
        }
        const text = await response.text();
        if (!text) {
            return undefined;
        }
        return JSON.parse(text);
    }
    async validateToken() {
        try {
            await this.listSites(1);
            return true;
        }
        catch {
            return false;
        }
    }
    async listSites(limit = 100) {
        const perPage = Math.max(1, Math.min(limit, 100));
        return this.request('GET', `/sites?per_page=${perPage}&page=1`);
    }
    async getSite(siteId) {
        return this.request('GET', `/sites/${encodeURIComponent(siteId)}`);
    }
    async createSite(payload) {
        return this.request('POST', '/sites', payload);
    }
    async listSiteDeploys(siteId, limit = 20) {
        const perPage = Math.max(1, Math.min(limit, 100));
        return this.request('GET', `/sites/${encodeURIComponent(siteId)}/deploys?per_page=${perPage}&page=1`);
    }
    async getDeploy(deployId) {
        return this.request('GET', `/deploys/${encodeURIComponent(deployId)}`);
    }
    async createSiteBuild(siteId, options) {
        const params = [];
        if (options?.branch) {
            params.push(`branch=${encodeURIComponent(options.branch)}`);
        }
        if (typeof options?.clear_cache === 'boolean') {
            params.push(`clear_cache=${options.clear_cache ? 'true' : 'false'}`);
        }
        if (options?.title) {
            params.push(`title=${encodeURIComponent(options.title)}`);
        }
        const query = params.length ? `?${params.join('&')}` : '';
        return this.request('POST', `/sites/${encodeURIComponent(siteId)}/builds${query}`);
    }
    async getBuild(buildId) {
        return this.request('GET', `/builds/${encodeURIComponent(buildId)}`);
    }
    async listSiteBuildHooks(siteId) {
        return this.request('GET', `/sites/${encodeURIComponent(siteId)}/build_hooks`);
    }
    async createSiteBuildHook(siteId, title, branch) {
        const payload = { title };
        if (branch) {
            payload.branch = branch;
        }
        return this.request('POST', `/sites/${encodeURIComponent(siteId)}/build_hooks`, payload);
    }
    async triggerBuildHook(url) {
        const response = await fetch(url, { method: 'POST' });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Netlify build hook trigger failed (${response.status}): ${text}`);
        }
    }
    async findSiteByNameOrRepo(name, repoUrl) {
        try {
            const sites = await this.listSites();
            const byName = sites.find((site) => site.name.toLowerCase() === name.toLowerCase());
            if (byName) {
                return byName;
            }
            if (!repoUrl) {
                return null;
            }
            const normalized = this.normalizeRepoUrl(repoUrl);
            const byRepo = sites.find((site) => {
                const candidates = [
                    site.repo?.repo_url,
                    site.build_settings?.repo_url,
                    site.repo?.repo_path,
                    site.build_settings?.repo_path,
                ].filter((value) => typeof value === 'string' && value.trim().length > 0);
                return candidates.some((candidate) => this.normalizeRepoUrl(candidate) === normalized);
            });
            return byRepo ?? null;
        }
        catch {
            return null;
        }
    }
    normalizeRepoUrl(url) {
        return url
            .replace(/^https?:\/\//i, '')
            .replace(/^git@github\.com:/i, 'github.com/')
            .replace(/\.git$/i, '')
            .toLowerCase();
    }
}
exports.NetlifyClient = NetlifyClient;
//# sourceMappingURL=netlifyClient.js.map