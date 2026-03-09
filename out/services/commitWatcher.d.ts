import { ProjectInfo } from '../utils/types';
/**
 * Periodically polls GitHub for new commits and notifies the user.
 * If a new commit SHA appears, shows a notification with Deploy or Redeploy action.
 */
export declare class CommitWatcher {
    private interval;
    private lastKnownSha;
    private githubClient;
    private projectInfo;
    private projectExistsRemotely;
    private onDeployRequested;
    private onRedeployRequested;
    /** Polling interval in milliseconds (60 seconds). */
    private static readonly POLL_INTERVAL_MS;
    constructor();
    /**
     * Start watching for new commits.
     * @param projectInfo         - Info about the current workspace project
     * @param existsRemotely      - Whether the project exists on a deployment provider
     * @param onDeploy            - Callback for "Deploy" action
     * @param onRedeploy          - Callback for "Redeploy" action
     */
    start(projectInfo: ProjectInfo, existsRemotely: boolean, onDeploy: () => void, onRedeploy: () => void): void;
    /** Stop the commit watcher. */
    stop(): void;
    /** Update whether the project exists remotely (for notification button). */
    setProjectExistsRemotely(exists: boolean): void;
    /** Fetch the latest commit SHA from GitHub. */
    private fetchLatestCommit;
    /** Check if there's a new commit and show a notification. */
    private checkForNewCommits;
}
//# sourceMappingURL=commitWatcher.d.ts.map