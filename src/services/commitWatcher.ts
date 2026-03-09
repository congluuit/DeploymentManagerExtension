import * as vscode from 'vscode';
import { GitHubClient } from '../clients/githubClient';
import { ProjectInfo } from '../utils/types';

/**
 * Periodically polls GitHub for new commits and notifies the user.
 * If a new commit SHA appears, shows a notification with Deploy or Redeploy action.
 */
export class CommitWatcher {
    private interval: ReturnType<typeof setInterval> | null = null;
    private lastKnownSha: string | null = null;
    private githubClient: GitHubClient;
    private projectInfo: ProjectInfo | null = null;
    private projectExistsRemotely: boolean = false;
    private onDeployRequested: (() => void) | null = null;
    private onRedeployRequested: (() => void) | null = null;

    /** Polling interval in milliseconds (60 seconds). */
    private static readonly POLL_INTERVAL_MS = 60_000;

    constructor() {
        this.githubClient = new GitHubClient();
    }

    /**
     * Start watching for new commits.
     * @param projectInfo         - Info about the current workspace project
     * @param existsRemotely      - Whether the project exists on a deployment provider
     * @param onDeploy            - Callback for "Deploy" action
     * @param onRedeploy          - Callback for "Redeploy" action
     */
    start(
        projectInfo: ProjectInfo,
        existsRemotely: boolean,
        onDeploy: () => void,
        onRedeploy: () => void
    ): void {
        this.stop();

        if (!projectInfo.repoOwner || !projectInfo.repoName) {
            return; // Cannot watch without GitHub repo info
        }

        this.projectInfo = projectInfo;
        this.projectExistsRemotely = existsRemotely;
        this.onDeployRequested = onDeploy;
        this.onRedeployRequested = onRedeploy;

        // Initial fetch to set the baseline SHA
        this.fetchLatestCommit().then((sha) => {
            this.lastKnownSha = sha;
        });

        // Start polling
        this.interval = setInterval(() => {
            this.checkForNewCommits();
        }, CommitWatcher.POLL_INTERVAL_MS);
    }

    /** Stop the commit watcher. */
    stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    /** Update whether the project exists remotely (for notification button). */
    setProjectExistsRemotely(exists: boolean): void {
        this.projectExistsRemotely = exists;
    }

    /** Fetch the latest commit SHA from GitHub. */
    private async fetchLatestCommit(): Promise<string | null> {
        if (!this.projectInfo?.repoOwner || !this.projectInfo?.repoName) {
            return null;
        }

        const commit = await this.githubClient.getLatestCommit(
            this.projectInfo.repoOwner,
            this.projectInfo.repoName,
            this.projectInfo.branch
        );

        return commit?.sha ?? null;
    }

    /** Check if there's a new commit and show a notification. */
    private async checkForNewCommits(): Promise<void> {
        const latestSha = await this.fetchLatestCommit();

        if (!latestSha || latestSha === this.lastKnownSha) {
            return;
        }

        // New commit detected!
        this.lastKnownSha = latestSha;
        const shortSha = latestSha.substring(0, 7);

        if (this.projectExistsRemotely) {
            const action = await vscode.window.showInformationMessage(
                `🚀 New commit detected (${shortSha}) on ${this.projectInfo?.branch}. Would you like to redeploy?`,
                'Redeploy',
                'Dismiss'
            );
            if (action === 'Redeploy' && this.onRedeployRequested) {
                this.onRedeployRequested();
            }
        } else {
            const action = await vscode.window.showInformationMessage(
                `🆕 New commit detected (${shortSha}) on ${this.projectInfo?.branch}. Would you like to deploy this project?`,
                'Deploy',
                'Dismiss'
            );
            if (action === 'Deploy' && this.onDeployRequested) {
                this.onDeployRequested();
            }
        }
    }
}
