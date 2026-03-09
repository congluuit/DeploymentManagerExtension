import * as vscode from 'vscode';
import { VercelClient } from '../clients/vercelClient';
import { CoolifyClient } from '../clients/coolifyClient';
import { ProjectDetector } from '../services/projectDetector';
import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys } from '../utils/types';

/**
 * Redeploy an existing project.
 * Enforces the "redeploy only if already exists" rule.
 */
export async function redeployProject(dashboardRefresh: () => void): Promise<void> {
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

    // Find which provider has the project
    type FoundProvider = { provider: string; id: string; name: string };
    const foundProviders: FoundProvider[] = [];

    if (hasVercel) {
        const vercel = new VercelClient();
        const existing = await vercel.findProjectByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            foundProviders.push({ provider: 'Vercel', id: existing.id, name: existing.name });
        }
    }

    if (hasCoolify) {
        const coolify = new CoolifyClient();
        const existing = await coolify.findApplicationByNameOrRepo(projectInfo.name, projectInfo.repoUrl);
        if (existing) {
            foundProviders.push({ provider: 'Coolify', id: existing.uuid, name: existing.name });
        }
    }

    if (foundProviders.length === 0) {
        vscode.window.showWarningMessage(
            `Project "${projectInfo.name}" does not exist on any connected provider. Use Deploy instead.`
        );
        return;
    }

    // If on multiple providers, let user pick
    let target: FoundProvider;
    if (foundProviders.length === 1) {
        target = foundProviders[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            foundProviders.map((p) => ({
                label: p.provider,
                description: `Redeploy "${p.name}" on ${p.provider}`,
                provider: p,
            })),
            { placeHolder: 'Select provider to redeploy on', ignoreFocusOut: true }
        );
        if (!picked) {
            return;
        }
        target = picked.provider;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Redeploying ${target.name} on ${target.provider}...`,
            cancellable: false,
        },
        async () => {
            try {
                if (target.provider === 'Vercel') {
                    const vercel = new VercelClient();
                    await vercel.createDeployment(target.name);
                    vscode.window.showInformationMessage(
                        `✅ Redeployment triggered for "${target.name}" on Vercel!`
                    );
                } else if (target.provider === 'Coolify') {
                    const coolify = new CoolifyClient();
                    await coolify.deployApplication(target.id);
                    vscode.window.showInformationMessage(
                        `✅ Redeployment triggered for "${target.name}" on Coolify!`
                    );
                }

                dashboardRefresh();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`❌ Redeployment failed: ${message}`);
            }
        }
    );
}
