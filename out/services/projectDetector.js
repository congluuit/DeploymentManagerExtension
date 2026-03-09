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
exports.ProjectDetector = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Detects information about the currently opened workspace project.
 * Reads package.json, .git/config, and .git/HEAD.
 */
class ProjectDetector {
    /**
     * Detect the current workspace project info.
     * Returns null if no workspace is open.
     */
    async detect() {
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
            }
            catch {
                // Fall back to folder name
            }
        }
        // Read git remote URL
        let repoUrl = null;
        let repoOwner = null;
        let repoName = null;
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
            }
            catch {
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
            }
            catch {
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
    parseRemoteUrl(gitConfig) {
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
    parseOwnerAndRepo(url) {
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
exports.ProjectDetector = ProjectDetector;
//# sourceMappingURL=projectDetector.js.map