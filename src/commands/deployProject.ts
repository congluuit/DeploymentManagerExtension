import * as vscode from 'vscode';
import { VercelClient } from '../clients/vercelClient';
import { CoolifyClient } from '../clients/coolifyClient';
import { ProjectDetector } from '../services/projectDetector';
import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys } from '../utils/types';

/**
 * Deploy a project that does not yet exist remotely.
 * Enforces the "deploy only if new" rule.
 */
export async function deployProject(dashboardRefresh: () => void): Promise<void> {
    const detector = new ProjectDetector();
    const projectInfo = await detector.detect();

    if (!projectInfo) {
        vscode.window.showErrorMessage('No workspace folder is open. Please open a project first.');
        return;
    }

    const storage = SecretStorageManager.getInstance();
    const hasVercel = await storage.has(StorageKeys.VERCEL_TOKEN);
    const hasCoolify = await storage.has(StorageKeys.COOLIFY_TOKEN);

    if (!hasVercel && !hasCoolify) {
        vscode.window.showErrorMessage('No deployment providers connected. Please connect Vercel or Coolify first.');
        return;
    }

    // Check if project already exists remotely
    if (hasVercel) {
        const vercel = new VercelClient();
        const existing = await vercel.findProjectByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            vscode.window.showWarningMessage(
                `Project "${projectInfo.name}" already exists on Vercel. Use Redeploy instead.`
            );
            return;
        }
    }

    if (hasCoolify) {
        const coolify = new CoolifyClient();
        const existing = await coolify.findApplicationByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            vscode.window.showWarningMessage(
                `Project "${projectInfo.name}" already exists on Coolify. Use Redeploy instead.`
            );
            return;
        }
    }

    // Build provider choices
    const providers: vscode.QuickPickItem[] = [];
    if (hasVercel) {
        providers.push({ label: 'Vercel', description: 'Deploy to Vercel' });
    }
    if (hasCoolify) {
        providers.push({ label: 'Coolify', description: 'Deploy to Coolify' });
    }

    const selected = await vscode.window.showQuickPick(providers, {
        placeHolder: 'Select deployment provider',
        ignoreFocusOut: true,
    });

    if (!selected) {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Deploying ${projectInfo.name} to ${selected.label}...`,
            cancellable: false,
        },
        async () => {
            try {
                if (selected.label === 'Vercel') {
                    const vercel = new VercelClient();
                    const gitRepo = projectInfo.repoOwner && projectInfo.repoName
                        ? { type: 'github', repo: `${projectInfo.repoOwner}/${projectInfo.repoName}` }
                        : undefined;

                    await vercel.createProject(projectInfo.name, gitRepo);
                    vscode.window.showInformationMessage(
                        `✅ Project "${projectInfo.name}" created and deployed on Vercel!`
                    );
                } else if (selected.label === 'Coolify') {
                    const coolify = new CoolifyClient();
                    await coolify.createApplication({
                        name: projectInfo.name,
                        git_repository: projectInfo.repoUrl || undefined,
                        git_branch: projectInfo.branch,
                    });
                    vscode.window.showInformationMessage(
                        `✅ Project "${projectInfo.name}" created and deployed on Coolify!`
                    );
                }

                dashboardRefresh();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`❌ Deployment failed: ${message}`);
            }
        }
    );
}
