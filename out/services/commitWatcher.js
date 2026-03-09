"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommitWatcher = void 0;
const vscode = __importStar(require("vscode"));
const githubClient_1 = require("../clients/githubClient");
/**
 * Periodically polls GitHub for new commits and notifies the user.
 * If a new commit SHA appears, shows a notification with Deploy or Redeploy action.
 */
class CommitWatcher {
    constructor() {
        this.interval = null;
        this.lastKnownSha = null;
        this.projectInfo = null;
        this.projectExistsRemotely = false;
        this.onDeployRequested = null;
        this.onRedeployRequested = null;
        this.githubClient = new githubClient_1.GitHubClient();
    }
    /**
     * Start watching for new commits.
     * @param projectInfo         - Info about the current workspace project
     * @param existsRemotely      - Whether the project exists on a deployment provider
     * @param onDeploy            - Callback for "Deploy" action
     * @param onRedeploy          - Callback for "Redeploy" action
     */
    start(projectInfo, existsRemotely, onDeploy, onRedeploy) {
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
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
    /** Update whether the project exists remotely (for notification button). */
    setProjectExistsRemotely(exists) {
        this.projectExistsRemotely = exists;
    }
    /** Fetch the latest commit SHA from GitHub. */
    async fetchLatestCommit() {
        if (!this.projectInfo?.repoOwner || !this.projectInfo?.repoName) {
            return null;
        }
        const commit = await this.githubClient.getLatestCommit(this.projectInfo.repoOwner, this.projectInfo.repoName, this.projectInfo.branch);
        return commit?.sha ?? null;
    }
    /** Check if there's a new commit and show a notification. */
    async checkForNewCommits() {
        const latestSha = await this.fetchLatestCommit();
        if (!latestSha || latestSha === this.lastKnownSha) {
            return;
        }
        // New commit detected!
        this.lastKnownSha = latestSha;
        const shortSha = latestSha.substring(0, 7);
        if (this.projectExistsRemotely) {
            const action = await vscode.window.showInformationMessage(`🚀 New commit detected (${shortSha}) on ${this.projectInfo?.branch}. Would you like to redeploy?`, 'Redeploy', 'Dismiss');
            if (action === 'Redeploy' && this.onRedeployRequested) {
                this.onRedeployRequested();
            }
        }
        else {
            const action = await vscode.window.showInformationMessage(`🆕 New commit detected (${shortSha}) on ${this.projectInfo?.branch}. Would you like to deploy this project?`, 'Deploy', 'Dismiss');
            if (action === 'Deploy' && this.onDeployRequested) {
                this.onDeployRequested();
            }
        }
    }
}
exports.CommitWatcher = CommitWatcher;
/** Polling interval in milliseconds (60 seconds). */
CommitWatcher.POLL_INTERVAL_MS = 60000;
//# sourceMappingURL=commitWatcher.js.map