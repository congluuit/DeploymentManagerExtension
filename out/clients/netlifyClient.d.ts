import { NetlifyBuild, NetlifyDeploy, NetlifySite } from '../utils/types';
export interface NetlifyBuildHook {
    id: string;
    title: string;
    branch?: string;
    url: string;
    site_id: string;
    created_at?: string;
}
/**
 * Netlify REST API client.
 * Authenticates with a personal access token.
 */
export declare class NetlifyClient {
    private secretStorage;
    constructor();
    private getToken;
    private getHeaders;
    private request;
    validateToken(): Promise<boolean>;
    listSites(limit?: number): Promise<NetlifySite[]>;
    getSite(siteId: string): Promise<NetlifySite>;
    createSite(payload: {
        name: string;
        repo?: {
            provider?: string;
            repo_path?: string;
            repo_url?: string;
            repo_branch?: string;
        };
    }): Promise<NetlifySite>;
    listSiteDeploys(siteId: string, limit?: number): Promise<NetlifyDeploy[]>;
    getDeploy(deployId: string): Promise<NetlifyDeploy>;
    createSiteBuild(siteId: string, options?: {
        branch?: string;
        clear_cache?: boolean;
        title?: string;
    }): Promise<NetlifyBuild>;
    getBuild(buildId: string): Promise<NetlifyBuild>;
    listSiteBuildHooks(siteId: string): Promise<NetlifyBuildHook[]>;
    createSiteBuildHook(siteId: string, title: string, branch?: string): Promise<NetlifyBuildHook>;
    triggerBuildHook(url: string): Promise<void>;
    findSiteByNameOrRepo(name: string, repoUrl: string | null): Promise<NetlifySite | null>;
    private normalizeRepoUrl;
}
//# sourceMappingURL=netlifyClient.d.ts.map