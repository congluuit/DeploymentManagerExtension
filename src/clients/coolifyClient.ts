import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys, CoolifyApplication } from '../utils/types';

/**
 * Coolify REST API client.
 * Authenticates via base URL + Bearer token provided by the user.
 */
export class CoolifyClient {
    private secretStorage: SecretStorageManager;

    constructor() {
        this.secretStorage = SecretStorageManager.getInstance();
    }

    /** Get the stored base URL. */
    private async getBaseUrl(): Promise<string> {
        const baseUrl = await this.secretStorage.get(StorageKeys.COOLIFY_BASE_URL);
        if (!baseUrl) {
            throw new Error('Coolify base URL not configured. Please connect Coolify first.');
        }
        return baseUrl.replace(/\/+$/, '');
    }

    /** Get the stored API token. */
    private async getToken(): Promise<string> {
        const token = await this.secretStorage.get(StorageKeys.COOLIFY_TOKEN);
        if (!token) {
            throw new Error('Coolify API token not configured. Please connect Coolify first.');
        }
        return token;
    }

    /** Build authorization headers. */
    private async getHeaders(): Promise<Record<string, string>> {
        const token = await this.getToken();
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };
    }

    /** Make an authenticated request to the Coolify API. */
    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const baseUrl = await this.getBaseUrl();
        const headers = await this.getHeaders();
        const url = `${baseUrl}${path}`;

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
            throw new Error(`Coolify API error (${response.status}): ${errorBody}`);
        }

        if (response.status === 204) {
            return undefined as T;
        }

        return response.json() as Promise<T>;
    }

    /** Validate the connection by listing applications. */
    async validateConnection(): Promise<boolean> {
        try {
            await this.request<CoolifyApplication[]>('GET', '/api/v1/applications');
            return true;
        } catch {
            return false;
        }
    }

    /** List all applications. */
    async listApplications(): Promise<CoolifyApplication[]> {
        return this.request<CoolifyApplication[]>('GET', '/api/v1/applications');
    }

    /** Get a single application by UUID. */
    async getApplication(uuid: string): Promise<CoolifyApplication> {
        return this.request<CoolifyApplication>('GET', `/api/v1/applications/${encodeURIComponent(uuid)}`);
    }

    /** Create a new application. */
    async createApplication(payload: {
        name: string;
        git_repository?: string;
        git_branch?: string;
        description?: string;
        project_uuid?: string;
        server_uuid?: string;
        environment_name?: string;
        destination_uuid?: string;
        type?: string;
    }): Promise<CoolifyApplication> {
        return this.request<CoolifyApplication>('POST', '/api/v1/applications', payload);
    }

    /** Delete an application by UUID. */
    async deleteApplication(uuid: string): Promise<void> {
        await this.request<void>('DELETE', `/api/v1/applications/${encodeURIComponent(uuid)}`);
    }

    /** Restart (redeploy) an application by UUID. */
    async deployApplication(uuid: string): Promise<{ message: string }> {
        return this.request<{ message: string }>('POST', `/api/v1/applications/${encodeURIComponent(uuid)}/restart`);
    }

    /** Get application logs. */
    async getApplicationLogs(uuid: string): Promise<string> {
        const result = await this.request<{ logs: string }>('GET', `/api/v1/applications/${encodeURIComponent(uuid)}/logs`);
        return result.logs || '';
    }

    /**
     * Import and upsert environment variables for an application.
     * Tries update first, then create if the key does not exist yet.
     */
    async upsertApplicationEnvVars(
        uuid: string,
        envVars: Record<string, string>
    ): Promise<{ imported: number; failed: string[] }> {
        let imported = 0;
        const failed: string[] = [];
        const encodedUuid = encodeURIComponent(uuid);

        for (const [key, value] of Object.entries(envVars)) {
            const payload = {
                key,
                value,
                is_preview: false,
                is_literal: true,
                is_multiline: value.includes('\n'),
                is_shown_once: false,
            };

            try {
                await this.request<unknown>('PATCH', `/api/v1/applications/${encodedUuid}/envs`, payload);
                imported += 1;
                continue;
            } catch {
                // Fallback to create for missing keys.
            }

            try {
                await this.request<unknown>('POST', `/api/v1/applications/${encodedUuid}/envs`, payload);
                imported += 1;
            } catch {
                failed.push(key);
            }
        }

        return { imported, failed };
    }

    /**
     * Check if an application exists by name or repo URL.
     * Returns the matched application or null.
     */
    async findApplicationByNameOrRepo(name: string, repoUrl: string | null): Promise<CoolifyApplication | null> {
        try {
            const apps = await this.listApplications();

            // Check by name
            const byName = apps.find(
                (a) => a.name.toLowerCase() === name.toLowerCase()
            );
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
