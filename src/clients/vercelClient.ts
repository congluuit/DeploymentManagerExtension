import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys, VercelProject, VercelDeployment } from '../utils/types';

const VERCEL_API_BASE = 'https://api.vercel.com';

/**
 * Vercel REST API client.
 * Handles authentication and all project/deployment operations.
 */
export class VercelClient {
    private secretStorage: SecretStorageManager;

    constructor() {
        this.secretStorage = SecretStorageManager.getInstance();
    }

    /** Get the stored API token. */
    private async getToken(): Promise<string> {
        const token = await this.secretStorage.get(StorageKeys.VERCEL_TOKEN);
        if (!token) {
            throw new Error('Vercel API token not configured. Please connect Vercel first.');
        }
        return token;
    }

    /** Build authorization headers. */
    private async getHeaders(): Promise<Record<string, string>> {
        const token = await this.getToken();
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };
    }

    /** Make an authenticated request to the Vercel API. */
    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const headers = await this.getHeaders();
        const url = `${VERCEL_API_BASE}${path}`;

        const options: RequestInit = {
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
            return undefined as T;
        }

        return response.json() as Promise<T>;
    }

    /** Check if the token is valid by listing projects. */
    async validateToken(): Promise<boolean> {
        try {
            await this.request<{ projects: VercelProject[] }>('GET', '/v9/projects?limit=1');
            return true;
        } catch {
            return false;
        }
    }

    /** Retrieve all projects. */
    async listProjects(): Promise<VercelProject[]> {
        const result = await this.request<{ projects: VercelProject[] }>('GET', '/v9/projects?limit=100');
        return result.projects;
    }

    /** Retrieve a single project by ID or name. */
    async getProject(idOrName: string): Promise<VercelProject> {
        return this.request<VercelProject>('GET', `/v9/projects/${encodeURIComponent(idOrName)}`);
    }

    /** Create a new project. */
    async createProject(name: string, gitRepository?: { type: string; repo: string }): Promise<VercelProject> {
        const body: Record<string, unknown> = { name };
        if (gitRepository) {
            body.gitRepository = gitRepository;
        }
        return this.request<VercelProject>('POST', '/v10/projects', body);
    }

    /** Delete a project by ID or name. */
    async deleteProject(idOrName: string): Promise<void> {
        await this.request<void>('DELETE', `/v9/projects/${encodeURIComponent(idOrName)}`);
    }

    /** List deployments for a project. */
    async listDeployments(projectId: string, limit: number = 20): Promise<VercelDeployment[]> {
        const result = await this.request<{ deployments: VercelDeployment[] }>(
            'GET',
            `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`
        );
        return result.deployments;
    }

    /** Create a new deployment. */
    async createDeployment(
        name: string,
        gitSource?: { type: string; ref: string; repoId: string | number }
    ): Promise<VercelDeployment> {
        const body: Record<string, unknown> = { name };
        if (gitSource) {
            body.gitSource = gitSource;
        }
        return this.request<VercelDeployment>('POST', '/v13/deployments', body);
    }

    /** Get deployment details. */
    async getDeployment(deploymentId: string): Promise<VercelDeployment> {
        return this.request<VercelDeployment>('GET', `/v13/deployments/${encodeURIComponent(deploymentId)}`);
    }

    /**
     * Check if a project exists by name or repo URL.
     * Returns the matched project or null.
     */
    async findProjectByNameOrRepo(name: string, repoUrl: string | null): Promise<VercelProject | null> {
        try {
            const projects = await this.listProjects();

            // Check by exact name match
            const byName = projects.find(
                (p) => p.name.toLowerCase() === name.toLowerCase()
            );
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
        } catch {
            return null;
        }
    }

    /** Normalize a repo URL for comparison. */
    private normalizeRepoUrl(url: string): string {
        return url
            .replace(/^https?:\/\//, '')
            .replace(/^git@github\.com:/, 'github.com/')
            .replace(/\.git$/, '')
            .toLowerCase();
    }
}
