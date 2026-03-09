import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from '../utils/types';

/**
 * Detects information about the currently opened workspace project.
 * Reads package.json, .git/config, and .git/HEAD.
 */
export class ProjectDetector {
    /**
     * Detect the current workspace project info.
     * Returns null if no workspace is open.
     */
    async detect(): Promise<ProjectInfo | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        const folderPath = workspaceFolders[0].uri.fsPath;
        const folderName = path.basename(folderPath);

        // Read project name from package.json
        let projectName = folderName;
        const packageJsonPath = path.join(folderPath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const content = fs.readFileSync(packageJsonPath, 'utf-8');
                const pkg = JSON.parse(content);
                if (pkg.name) {
                    projectName = pkg.name;
                }
            } catch {
                // Fall back to folder name
            }
        }

        // Read git remote URL
        let repoUrl: string | null = null;
        let repoOwner: string | null = null;
        let repoName: string | null = null;
        const gitConfigPath = path.join(folderPath, '.git', 'config');
        if (fs.existsSync(gitConfigPath)) {
            try {
                const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
                repoUrl = this.parseRemoteUrl(gitConfig);
                if (repoUrl) {
                    const parsed = this.parseOwnerAndRepo(repoUrl);
                    repoOwner = parsed.owner;
                    repoName = parsed.repo;
                }
            } catch {
                // No git info available
            }
        }

        // Read current branch
        let branch = 'main';
        const headPath = path.join(folderPath, '.git', 'HEAD');
        if (fs.existsSync(headPath)) {
            try {
                const headContent = fs.readFileSync(headPath, 'utf-8').trim();
                const refMatch = headContent.match(/^ref: refs\/heads\/(.+)$/);
                if (refMatch) {
                    branch = refMatch[1];
                }
            } catch {
                // Default to 'main'
            }
        }

        return {
            name: projectName,
            folderPath,
            repoUrl,
            repoOwner,
            repoName,
            branch,
        };
    }

    /** Parse the origin remote URL from git config content. */
    private parseRemoteUrl(gitConfig: string): string | null {
        const lines = gitConfig.split('\n');
        let inOriginRemote = false;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === '[remote "origin"]') {
                inOriginRemote = true;
                continue;
            }

            if (trimmed.startsWith('[') && inOriginRemote) {
                break; // Reached next section
            }

            if (inOriginRemote && trimmed.startsWith('url =')) {
                return trimmed.replace('url =', '').trim();
            }
        }

        return null;
    }

    /** Parse owner and repo name from a Git remote URL. */
    private parseOwnerAndRepo(url: string): { owner: string | null; repo: string | null } {
        // Handle SSH URLs: git@github.com:owner/repo.git
        const sshMatch = url.match(/git@[\w.-]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
        if (sshMatch) {
            return { owner: sshMatch[1], repo: sshMatch[2] };
        }

        // Handle HTTPS URLs: https://github.com/owner/repo.git
        const httpsMatch = url.match(/https?:\/\/[\w.-]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
        if (httpsMatch) {
            return { owner: httpsMatch[1], repo: httpsMatch[2] };
        }

        return { owner: null, repo: null };
    }
}
