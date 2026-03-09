import { CoolifyApplication } from '../utils/types';
/**
 * Coolify REST API client.
 * Authenticates via base URL + Bearer token provided by the user.
 */
export declare class CoolifyClient {
    private secretStorage;
    constructor();
    /** Get the stored base URL. */
    private getBaseUrl;
    /** Get the stored API token. */
    private getToken;
    /** Build authorization headers. */
    private getHeaders;
    /** Make an authenticated request to the Coolify API. */
    private request;
    /** Validate the connection by listing applications. */
    validateConnection(): Promise<boolean>;
    /** List all applications. */
    listApplications(): Promise<CoolifyApplication[]>;
    /** Get a single application by UUID. */
    getApplication(uuid: string): Promise<CoolifyApplication>;
    /** Create a new application. */
    createApplication(payload: {
        name: string;
        git_repository?: string;
        git_branch?: string;
        description?: string;
        project_uuid?: string;
        server_uuid?: string;
        environment_name?: string;
        destination_uuid?: string;
        type?: string;
    }): Promise<CoolifyApplication>;
    /** Delete an application by UUID. */
    deleteApplication(uuid: string): Promise<void>;
    /** Restart (redeploy) an application by UUID. */
    deployApplication(uuid: string): Promise<{
        message: string;
    }>;
    /** Get application logs. */
    getApplicationLogs(uuid: string): Promise<string>;
    /**
     * Check if an application exists by name or repo URL.
     * Returns the matched application or null.
     */
    findApplicationByNameOrRepo(name: string, repoUrl: string | null): Promise<CoolifyApplication | null>;
    /** Normalize a repo URL for comparison. */
    private normalizeRepoUrl;
}
//# sourceMappingURL=coolifyClient.d.ts.map