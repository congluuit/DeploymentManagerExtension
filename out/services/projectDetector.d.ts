import { ProjectInfo } from '../utils/types';
/**
 * Detects information about the currently opened workspace project.
 * Reads package.json, .git/config, and .git/HEAD.
 */
export declare class ProjectDetector {
    /**
     * Detect the current workspace project info.
     * Returns null if no workspace is open.
     */
    detect(): Promise<ProjectInfo | null>;
    /** Parse the origin remote URL from git config content. */
    private parseRemoteUrl;
    /** Parse owner and repo name from a Git remote URL. */
    private parseOwnerAndRepo;
}
//# sourceMappingURL=projectDetector.d.ts.map