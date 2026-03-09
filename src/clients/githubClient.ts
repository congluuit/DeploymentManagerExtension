import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys, GitHubCommit } from '../utils/types';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * GitHub API client for commit monitoring.
 * Supports public repos without auth and private repos with optional token.
 */
export class GitHubClient {
    private secretStorage: SecretStorageManager;

    constructor() {
        this.secretStorage = SecretStorageManager.getInstance();
    }

    /** Build request headers. Includes auth token if available. */
    private async getHeaders(): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'DeploymentManager-VSCode-Extension',
        };

        try {
            const token = await this.secretStorage.get(StorageKeys.GITHUB_TOKEN);
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
        } catch {
            // No token — fine for public repos
        }

        return headers;
    }

    /** Make a request to the GitHub API. */
    private async request<T>(path: string): Promise<T> {
        const headers = await this.getHeaders();
        const url = `${GITHUB_API_BASE}${path}`;

        const response = await fetch(url, { method: 'GET', headers });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`GitHub API error (${response.status}): ${errorBody}`);
        }

        return response.json() as Promise<T>;
    }

    /**
     * Get the latest commit on a specific branch.
     * @param owner  - Repository owner (username or org)
     * @param repo   - Repository name
     * @param branch - Branch name (defaults to 'main')
     */
    async getLatestCommit(owner: string, repo: string, branch: string = 'main'): Promise<GitHubCommit | null> {
        try {
            const commits = await this.request<GitHubCommit[]>(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=1`
            );
            return commits.length > 0 ? commits[0] : null;
        } catch {
            return null;
        }
    }

    /**
     * Get the latest N commits on a branch.
     */
    async getCommits(owner: string, repo: string, branch: string = 'main', count: number = 10): Promise<GitHubCommit[]> {
        try {
            return await this.request<GitHubCommit[]>(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${encodeURIComponent(branch)}&per_page=${count}`
            );
        } catch {
            return [];
        }
    }
}
