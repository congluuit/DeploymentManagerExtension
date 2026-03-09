import { VercelProject, VercelDeployment } from '../utils/types';
/**
 * Vercel REST API client.
 * Handles authentication and all project/deployment operations.
 */
export declare class VercelClient {
    private secretStorage;
    constructor();
    /** Get the stored API token. */
    private getToken;
    /** Build authorization headers. */
    private getHeaders;
    /** Make an authenticated request to the Vercel API. */
    private request;
    /** Check if the token is valid by listing projects. */
    validateToken(): Promise<boolean>;
    /** Retrieve all projects. */
    listProjects(): Promise<VercelProject[]>;
    /** Retrieve a single project by ID or name. */
    getProject(idOrName: string): Promise<VercelProject>;
    /** Create a new project. */
    createProject(name: string, gitRepository?: {
        type: string;
        repo: string;
    }): Promise<VercelProject>;
    /** Delete a project by ID or name. */
    deleteProject(idOrName: string): Promise<void>;
    /** List deployments for a project. */
    listDeployments(projectId: string, limit?: number): Promise<VercelDeployment[]>;
    /** Create a new deployment. */
    createDeployment(name: string, gitSource?: {
        type: string;
        ref: string;
        repoId: string | number;
    }): Promise<VercelDeployment>;
    /** Get deployment details. */
    getDeployment(deploymentId: string): Promise<VercelDeployment>;
    /**
     * Check if a project exists by name or repo URL.
     * Returns the matched project or null.
     */
    findProjectByNameOrRepo(name: string, repoUrl: string | null): Promise<VercelProject | null>;
    /** Normalize a repo URL for comparison. */
    private normalizeRepoUrl;
}
//# sourceMappingURL=vercelClient.d.ts.map