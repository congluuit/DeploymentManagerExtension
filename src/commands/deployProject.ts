import * as vscode from 'vscode';
import { ProjectDetector } from '../services/projectDetector';
import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys } from '../utils/types';
import { getProvider } from '../providers';
import { ProviderName } from '../providers/providerTypes';

const PROVIDER_CONNECTION_KEYS: Record<ProviderName, string> = {
    Vercel: StorageKeys.VERCEL_TOKEN,
    Coolify: StorageKeys.COOLIFY_TOKEN,
    Netlify: StorageKeys.NETLIFY_TOKEN,
};

/**
 * Deploy a project that does not yet exist remotely.
 * Enforces the "deploy only if new" rule.
 */
export async function deployProject(): Promise<void> {
    const detector = new ProjectDetector();
    const projectInfo = await detector.detect();

    if (!projectInfo) {
        vscode.window.showErrorMessage('No workspace folder is open. Please open a project first.');
        return;
    }

    const storage = SecretStorageManager.getInstance();
    const connectedProviders: ProviderName[] = [];

    for (const providerName of Object.keys(PROVIDER_CONNECTION_KEYS) as ProviderName[]) {
        if (await storage.has(PROVIDER_CONNECTION_KEYS[providerName])) {
            connectedProviders.push(providerName);
        }
    }

    if (connectedProviders.length === 0) {
        vscode.window.showErrorMessage('No deployment providers connected. Please connect Vercel, Coolify, or Netlify first.');
        return;
    }

    const existingProviders: ProviderName[] = [];
    for (const providerName of connectedProviders) {
        const adapter = getProvider(providerName);
        const existing = await adapter.findExistingProject(projectInfo);
        if (existing) {
            existingProviders.push(providerName);
        }
    }

    if (existingProviders.length > 0) {
        const list = existingProviders.join(', ');
        vscode.window.showWarningMessage(
            `Project "${projectInfo.name}" already exists on ${list}. Use Redeploy instead.`
        );
        return;
    }

    const selected = await vscode.window.showQuickPick(
        connectedProviders.map((provider) => ({
            label: provider,
            description: `Deploy to ${provider}`,
        })),
        {
            placeHolder: 'Select deployment provider',
            ignoreFocusOut: true,
        }
    );

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
                const provider = selected.label as ProviderName;
                const adapter = getProvider(provider);
                await adapter.createProject(projectInfo);
                vscode.window.showInformationMessage(
                    `Project "${projectInfo.name}" created on ${provider}.`
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Deployment failed: ${message}`);
            }
        }
    );
}
