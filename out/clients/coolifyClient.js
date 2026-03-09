"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoolifyClient = void 0;
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
/**
 * Coolify REST API client.
 * Authenticates via base URL + Bearer token provided by the user.
 */
class CoolifyClient {
    constructor() {
        this.secretStorage = secretStorage_1.SecretStorageManager.getInstance();
    }
    /** Get the stored base URL. */
    async getBaseUrl() {
        const baseUrl = await this.secretStorage.get(types_1.StorageKeys.COOLIFY_BASE_URL);
        if (!baseUrl) {
            throw new Error('Coolify base URL not configured. Please connect Coolify first.');
        }
        return baseUrl.replace(/\/+$/, '');
    }
    /** Get the stored API token. */
    async getToken() {
        const token = await this.secretStorage.get(types_1.StorageKeys.COOLIFY_TOKEN);
        if (!token) {
            throw new Error('Coolify API token not configured. Please connect Coolify first.');
        }
        return token;
    }
    /** Build authorization headers. */
    async getHeaders() {
        const token = await this.getToken();
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    }
    /** Make an authenticated request to the Coolify API. */
    async request(method, path, body) {
        const baseUrl = await this.getBaseUrl();
        const headers = await this.getHeaders();
        const url = `${baseUrl}${path}`;
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
            throw new Error(`Coolify API error (${response.status}): ${errorBody}`);
        }
        if (response.status === 204) {
            return undefined;
        }
        return response.json();
    }
    /** Validate the connection by listing applications. */
    async validateConnection() {
        try {
            await this.request('GET', '/api/v1/applications');
            return true;
        }
        catch {
            return false;
        }
    }
    /** List all applications. */
    async listApplications() {
        return this.request('GET', '/api/v1/applications');
    }
    /** Get a single application by UUID. */
    async getApplication(uuid) {
        return this.request('GET', `/api/v1/applications/${encodeURIComponent(uuid)}`);
    }
    /** Create a new application. */
    async createApplication(payload) {
        return this.request('POST', '/api/v1/applications', payload);
    }
    /** Delete an application by UUID. */
    async deleteApplication(uuid) {
        await this.request('DELETE', `/api/v1/applications/${encodeURIComponent(uuid)}`);
    }
    /** Restart (redeploy) an application by UUID. */
    async deployApplication(uuid) {
        return this.request('POST', `/api/v1/applications/${encodeURIComponent(uuid)}/restart`);
    }
    /** Get application logs. */
    async getApplicationLogs(uuid) {
        const result = await this.request('GET', `/api/v1/applications/${encodeURIComponent(uuid)}/logs`);
        return result.logs || '';
    }
    /**
     * Check if an application exists by name or repo URL.
     * Returns the matched application or null.
     */
    async findApplicationByNameOrRepo(name, repoUrl) {
        try {
            const apps = await this.listApplications();
            // Check by name
            const byName = apps.find((a) => a.name.toLowerCase() === name.toLowerCase());
            if (byName) {
                return byName;
            }
            // Check by repo URL
            if (repoUrl) {
                const normalizedUrl = this.normalizeRepoUrl(repoUrl);
                const byRepo = apps.find((a) => {
                    if (a.git_repository) {
                        return this.normalizeRepoUrl(a.git_repository) === normalizedUrl;
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
exports.CoolifyClient = CoolifyClient;
//# sourceMappingURL=coolifyClient.js.map