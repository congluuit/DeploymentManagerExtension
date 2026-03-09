/**
 * Shared types and interfaces for the Deployment Manager extension.
 */

/** Information about the currently opened workspace project. */
export interface ProjectInfo {
    /** Project name from package.json or folder name */
    name: string;
    /** Full path to the workspace folder */
    folderPath: string;
    /** Remote repository URL (e.g. https://github.com/owner/repo.git) */
    repoUrl: string | null;
    /** Repository owner (GitHub username or org) */
    repoOwner: string | null;
    /** Repository name */
    repoName: string | null;
    /** Current branch name */
    branch: string;
}

/** Status of a provider connection. */
export interface ProviderStatus {
    connected: boolean;
    name: 'Vercel' | 'Coolify';
    baseUrl?: string;
}

/** Vercel project as returned by the API. */
export interface VercelProject {
    id: string;
    name: string;
    accountId: string;
    createdAt: number;
    updatedAt: number;
    framework: string | null;
    link?: {
        type: string;
        repo: string;
        repoId: number;
        org: string;
        gitCredentialId: string;
        productionBranch: string;
        createdAt: number;
        updatedAt: number;
        deployHooks: unknown[];
    };
    latestDeployments?: VercelDeployment[];
}

/** Vercel deployment as returned by the API. */
export interface VercelDeployment {
    uid: string;
    name: string;
    url: string;
    state: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
    created: number;
    createdAt: number;
    buildingAt?: number;
    ready?: number;
    source?: string;
    meta?: Record<string, string>;
}

/** Coolify application as returned by the API. */
export interface CoolifyApplication {
    uuid: string;
    name: string;
    description: string | null;
    fqdn: string | null;
    repository_project_id: number | null;
    git_repository: string | null;
    git_branch: string | null;
    status: string;
    created_at: string;
    updated_at: string;
}

/** Result from GitHub commits endpoint. */
export interface GitHubCommit {
    sha: string;
    commit: {
        message: string;
        author: {
            name: string;
            date: string;
        };
    };
    html_url: string;
}

/** Tree item types used in the dashboard. */
export type DashboardItemType =
    | 'header'
    | 'projectInfo'
    | 'providerStatus'
    | 'vercelProject'
    | 'coolifyApp'
    | 'deployAction'
    | 'redeployAction'
    | 'connectAction'
    | 'noItems';

/** Storage keys for SecretStorage. */
export const StorageKeys = {
    VERCEL_TOKEN: 'deploymentManager.vercel.token',
    COOLIFY_TOKEN: 'deploymentManager.coolify.token',
    COOLIFY_BASE_URL: 'deploymentManager.coolify.baseUrl',
    GITHUB_TOKEN: 'deploymentManager.github.token',
} as const;
