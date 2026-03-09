import { GitHubCommit } from '../utils/types';
/**
 * GitHub API client for commit monitoring.
 * Supports public repos without auth and private repos with optional token.
 */
export declare class GitHubClient {
    private secretStorage;
    constructor();
    /** Build request headers. Includes auth token if available. */
    private getHeaders;
    /** Make a request to the GitHub API. */
    private request;
    /**
     * Get the latest commit on a specific branch.
     * @param owner  - Repository owner (username or org)
     * @param repo   - Repository name
     * @param branch - Branch name (defaults to 'main')
     */
    getLatestCommit(owner: string, repo: string, branch?: string): Promise<GitHubCommit | null>;
    /**
     * Get the latest N commits on a branch.
     */
    getCommits(owner: string, repo: string, branch?: string, count?: number): Promise<GitHubCommit[]>;
}
//# sourceMappingURL=githubClient.d.ts.map