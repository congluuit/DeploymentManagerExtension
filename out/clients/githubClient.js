"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubClient = void 0;
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
const GITHUB_API_BASE = 'https://api.github.com';
/**
 * GitHub API client for commit monitoring.
 * Supports public repos without auth and private repos with optional token.
 */
class GitHubClient {
    constructor() {
        this.secretStorage = secretStorage_1.SecretStorageManager.getInstance();
    }
    /** Build request headers. Includes auth token if available. */
    async getHeaders() {
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'DeploymentManager-VSCode-Extension',
        };
        try {
            const token = await this.secretStorage.get(types_1.StorageKeys.GITHUB_TOKEN);
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        }
        catch {
            // No token — fine for public repos
        }
        return headers;
    }
    /** Make a request to the GitHub API. */
    async request(path) {
        const headers = await this.getHeaders();
        const url = `${GITHUB_API_BASE}${path}`;
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
        }
        return response.json();
    }
    /**
     * Get the latest commit on a specific branch.
     * @param owner  - Repository owner (username or org)
     * @param repo   - Repository name
     * @param branch - Branch name (defaults to 'main')
     */
    async getLatestCommit(owner, repo, branch = 'main') {
        try {
            const commits = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=1`);
            return commits.length > 0 ? commits[0] : null;
        }
        catch {
            return null;
        }
    }
    /**
     * Get the latest N commits on a branch.
     */
    async getCommits(owner, repo, branch = 'main', count = 10) {
        try {
            return await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${count}`);
        }
        catch {
            return [];
        }
    }
}
exports.GitHubClient = GitHubClient;
//# sourceMappingURL=githubClient.js.map