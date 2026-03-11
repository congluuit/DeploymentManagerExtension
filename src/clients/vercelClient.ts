import { SecretStorageManager } from '../utils/secretStorage';
import {
    StorageKeys,
    VercelProject,
    VercelDeployment,
    VercelDeploymentEvent,
} from '../utils/types';

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
        options?: {
            gitSource?: { type: string; ref: string; repoId: string | number };
            project?: string;
            deploymentId?: string;
            withLatestCommit?: boolean;
            target?: 'production' | 'staging' | string;
        }
    ): Promise<VercelDeployment> {
        const body: Record<string, unknown> = { name };
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
        return this.request<VercelDeployment>('POST', '/v13/deployments', body);
    }

    /**
     * Trigger a deployment from the linked Git repository.
     * Uses latest commit from the provided branch (or production branch fallback).
     */
    async deployProjectFromGit(
        projectId: string,
        name: string,
        options?: {
            branch?: string;
            repoId?: string | number;
            target?: 'production' | 'staging' | string;
        }
    ): Promise<VercelDeployment> {
        const project = await this.getProject(projectId);
        const repoId = options?.repoId ?? project.link?.repoId;
        const ref = options?.branch || project.link?.productionBranch || 'main';
        const target = options?.target ?? 'production';

        if (repoId !== undefined && repoId !== null) {
            return this.createDeployment(name, {
                project: projectId,
                target,
                gitSource: {
                    type: 'github',
                    ref,
                    repoId,
                },
            });
        }

        return this.createDeployment(name, {
            project: projectId,
            target,
        });
    }

    /**
     * Redeploy an existing Vercel project.
     * Always deploys from the latest commit of the linked Git branch.
     */
    async redeployProject(projectId: string, name: string): Promise<VercelDeployment> {
        return this.deployProjectFromGit(projectId, name);
    }

    /** Get deployment details. */
    async getDeployment(deploymentId: string): Promise<VercelDeployment> {
        return this.request<VercelDeployment>('GET', `/v13/deployments/${encodeURIComponent(deploymentId)}`);
    }

    /** Get deployment events/log stream entries for status tracking and failure analysis. */
    async getDeploymentEvents(
        deploymentId: string,
        options?: { limit?: number; since?: number; direction?: 'forward' | 'backward' }
    ): Promise<VercelDeploymentEvent[]> {
        const query = new URLSearchParams();
        if (typeof options?.limit === 'number' && options.limit > 0) {
            query.set('limit', String(options.limit));
        }
        if (typeof options?.since === 'number' && options.since > 0) {
            query.set('since', String(options.since));
        }
        if (options?.direction) {
            query.set('direction', options.direction);
        }
        query.set('builds', '1');
        query.set('follow', '0');

        const suffix = query.toString();
        const response = await this.request<unknown>(
            'GET',
            `/v3/deployments/${encodeURIComponent(deploymentId)}/events${suffix ? `?${suffix}` : ''}`
        );

        if (Array.isArray(response)) {
            return response as VercelDeploymentEvent[];
        }

        if (response && typeof response === 'object') {
            const events = (response as { events?: unknown }).events;
            if (Array.isArray(events)) {
                return events as VercelDeploymentEvent[];
            }
        }

        return [];
    }

    /**
     * Import and upsert environment variables for a project.
     * Uses Vercel's upsert mode so existing keys are replaced.
     */
    async upsertProjectEnvVars(
        projectId: string,
        envVars: Record<string, string>,
        targets: string[] = ['production', 'preview', 'development']
    ): Promise<{ imported: number; failed: string[] }> {
        let imported = 0;
        const failed: string[] = [];

        for (const [key, value] of Object.entries(envVars)) {
            try {
                await this.request<unknown>(
                    'POST',
                    `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`,
                    {
                        key,
                        value,
                        target: targets,
                        type: 'plain',
                    }
                );
                imported += 1;
            } catch {
                failed.push(key);
            }
        }

        return { imported, failed };
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
