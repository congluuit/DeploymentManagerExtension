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
    name: 'Vercel' | 'Coolify' | 'Netlify';
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
    id?: string;
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

/** Netlify repository metadata as returned by the API. */
export interface NetlifyRepoInfo {
    id?: number;
    provider?: string;
    repo_path?: string;
    repo_branch?: string;
    repo_url?: string;
}

/** Netlify deploy as returned by the API. */
export interface NetlifyDeploy {
    id: string;
    site_id: string;
    build_id?: string;
    state: string;
    name?: string;
    url?: string;
    ssl_url?: string;
    admin_url?: string;
    deploy_url?: string;
    deploy_ssl_url?: string;
    error_message?: string;
    branch?: string;
    commit_ref?: string;
    created_at?: string;
    updated_at?: string;
    published_at?: string;
    title?: string;
    context?: string;
}

/** Netlify build as returned by the API. */
export interface NetlifyBuild {
    id: string;
    deploy_id?: string;
    sha?: string;
    done?: boolean;
    error?: string;
    created_at?: string;
}

/** Netlify site as returned by the API. */
export interface NetlifySite {
    id: string;
    name: string;
    account_id?: string;
    state?: string;
    url?: string;
    ssl_url?: string;
    admin_url?: string;
    deploy_url?: string;
    created_at?: string;
    updated_at?: string;
    build_settings?: NetlifyRepoInfo;
    repo?: NetlifyRepoInfo;
    deploy_hook?: string;
    published_deploy?: NetlifyDeploy;
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
    | 'netlifySite'
    | 'deployAction'
    | 'redeployAction'
    | 'connectAction'
    | 'noItems';

/** Storage keys for SecretStorage. */
export const StorageKeys = {
    VERCEL_TOKEN: 'deploymentManager.vercel.token',
    COOLIFY_TOKEN: 'deploymentManager.coolify.token',
    COOLIFY_BASE_URL: 'deploymentManager.coolify.baseUrl',
    NETLIFY_TOKEN: 'deploymentManager.netlify.token',
    GITHUB_TOKEN: 'deploymentManager.github.token',
} as const;
