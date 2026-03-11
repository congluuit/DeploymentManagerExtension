import * as vscode from 'vscode';
import { ProjectDetector } from '../services/projectDetector';
import { getProvider } from '../providers';
import { ProviderName, ProviderStatusUpdate } from '../providers/providerTypes';
import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys } from '../utils/types';

const PROVIDER_CONNECTION_KEYS: Record<ProviderName, string> = {
    Vercel: StorageKeys.VERCEL_TOKEN,
    Coolify: StorageKeys.COOLIFY_TOKEN,
    Netlify: StorageKeys.NETLIFY_TOKEN,
};

export interface RedeployTarget {
    provider: ProviderName;
    id: string;
    name: string;
}

export interface RedeployOptions {
    target?: RedeployTarget;
    notify?: boolean;
    refreshDashboard?: boolean;
    onStatus?: (update: ProviderStatusUpdate) => void;
}

export interface RedeployResult {
    success: boolean;
    error?: string;
}

/**
 * Redeploy an existing project.
 * Enforces the "redeploy only if already exists" rule.
 */
export async function redeployProject(
    dashboardRefresh: () => void,
    options?: RedeployOptions
): Promise<RedeployResult> {
    const notify = options?.notify ?? true;
    const refreshDashboard = options?.refreshDashboard ?? false;
    const onStatus = options?.onStatus;

    const detector = new ProjectDetector();
    const projectInfo = await detector.detect();

    if (!projectInfo) {
        const message = 'No workspace folder is open. Please open a project first.';
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }

    const storage = SecretStorageManager.getInstance();
    const connectedProviders: ProviderName[] = [];

    for (const providerName of Object.keys(PROVIDER_CONNECTION_KEYS) as ProviderName[]) {
        if (await storage.has(PROVIDER_CONNECTION_KEYS[providerName])) {
            connectedProviders.push(providerName);
        }
    }

    if (connectedProviders.length === 0) {
        const message = 'No deployment providers connected. Please connect Vercel, Coolify, or Netlify first.';
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }

    type FoundProvider = { provider: ProviderName; id: string; name: string };
    const foundProviders: FoundProvider[] = options?.target
        ? [{ provider: options.target.provider, id: options.target.id, name: options.target.name }]
        : [];

    if (!options?.target && projectInfo) {
        for (const providerName of connectedProviders) {
            const adapter = getProvider(providerName);
            const existing = await adapter.findExistingProject(projectInfo);
            if (existing) {
                foundProviders.push({ provider: providerName, id: existing.id, name: existing.name });
            }
        }
    }

    if (foundProviders.length === 0) {
        const projectName = projectInfo?.name || options?.target?.name || 'Current project';
        const message = `Project "${projectName}" does not exist on any connected provider. Use Deploy instead.`;
        if (notify) {
            vscode.window.showWarningMessage(message);
        }
        return { success: false, error: message };
    }

    let target: FoundProvider;
    if (options?.target || foundProviders.length === 1) {
        target = foundProviders[0];
    } else {
        const picked = await vscode.window.showQuickPick(
            foundProviders.map((provider) => ({
                label: provider.provider,
                description: `Redeploy "${provider.name}" on ${provider.provider}`,
                provider,
            })),
            { placeHolder: 'Select provider to redeploy on', ignoreFocusOut: true }
        );

        if (!picked) {
            return { success: false, error: 'Redeploy canceled.' };
        }

        target = picked.provider;
    }

    const isConnected = connectedProviders.includes(target.provider);
    if (!isConnected) {
        const message = `${target.provider} is not connected. Please connect ${target.provider} first.`;
        if (notify) {
            vscode.window.showErrorMessage(message);
        }
        return { success: false, error: message };
    }

    let runError: string | null = null;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Redeploying ${target.name} on ${target.provider}...`,
            cancellable: false,
        },
        async (progress) => {
            try {
                const adapter = getProvider(target.provider);
                onStatus?.({
                    phase: 'info',
                    message: `Starting redeploy on ${target.provider}...`,
                    timestamp: Date.now(),
                });
                const result = await adapter.redeploy(
                    { id: target.id, name: target.name },
                    { progress, onStatus, projectPath: projectInfo?.folderPath }
                );
                onStatus?.({
                    phase: 'ready',
                    message: `Redeploy finished on ${target.provider}.`,
                    timestamp: Date.now(),
                });

                if (notify) {
                    const urlSuffix = result.deploymentUrl ? ` URL: ${result.deploymentUrl}` : '';
                    vscode.window.showInformationMessage(
                        `Redeployment succeeded for "${target.name}" on ${target.provider}.${urlSuffix}`
                    );
                }

                if (refreshDashboard) {
                    await Promise.resolve(dashboardRefresh());
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                runError = message;
                onStatus?.({
                    phase: 'failed',
                    message,
                    timestamp: Date.now(),
                });
                if (notify) {
                    vscode.window.showErrorMessage(`Redeployment failed: ${message}`);
                }
            }
        }
    );

    if (runError) {
        return { success: false, error: runError };
    }

    return { success: true };
}
