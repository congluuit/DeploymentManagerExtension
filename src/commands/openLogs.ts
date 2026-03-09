import * as vscode from 'vscode';
import { getProvider } from '../providers';
import { ProviderName } from '../providers/providerTypes';
import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys } from '../utils/types';

const PROVIDER_CONNECTION_KEYS: Record<ProviderName, string> = {
    Vercel: StorageKeys.VERCEL_TOKEN,
    Coolify: StorageKeys.COOLIFY_TOKEN,
    Netlify: StorageKeys.NETLIFY_TOKEN,
};

function isProviderName(value: string | undefined): value is ProviderName {
    return value === 'Vercel' || value === 'Coolify' || value === 'Netlify';
}

/**
 * Open deployment logs in a Webview panel.
 * Supports Vercel, Coolify, and Netlify resources.
 */
export async function openLogs(provider?: string, projectId?: string, projectName?: string): Promise<void> {
    if (!provider || !projectId) {
        const storage = SecretStorageManager.getInstance();
        const connectedProviders: ProviderName[] = [];

        for (const name of Object.keys(PROVIDER_CONNECTION_KEYS) as ProviderName[]) {
            if (await storage.has(PROVIDER_CONNECTION_KEYS[name])) {
                connectedProviders.push(name);
            }
        }

        if (connectedProviders.length === 0) {
            vscode.window.showErrorMessage('No providers connected. Connect a provider first.');
            return;
        }

        const selectedProvider = await vscode.window.showQuickPick(
            connectedProviders.map((name) => ({
                label: name,
                description: `View ${name} deployment logs`,
            })),
            { placeHolder: 'Select a provider to view logs from', ignoreFocusOut: true }
        );

        if (!selectedProvider) {
            return;
        }

        provider = selectedProvider.label;
        const adapter = getProvider(provider as ProviderName);
        const projects = await adapter.listProjects();

        if (projects.length === 0) {
            vscode.window.showWarningMessage(`No ${provider} projects found.`);
            return;
        }

        const projectPick = await vscode.window.showQuickPick(
            projects.map((project) => ({
                label: project.name,
                description: project.id,
                id: project.id,
            })),
            { placeHolder: `Select a ${provider} project`, ignoreFocusOut: true }
        );

        if (!projectPick) {
            return;
        }

        projectId = projectPick.id;
        projectName = projectPick.label;
    }

    if (!isProviderName(provider)) {
        vscode.window.showErrorMessage('Unknown provider selected.');
        return;
    }

    const providerName = provider;
    const displayName = projectName || projectId;
    const panel = vscode.window.createWebviewPanel(
        'deploymentLogs',
        `Logs: ${displayName}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.html = getLoadingHtml(displayName);

    try {
        const adapter = getProvider(providerName);
        const logsContent = await adapter.getLogs(projectId);
        panel.webview.html = getLogsHtml(displayName, logsContent, providerName);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        panel.webview.html = getLogsHtml(displayName, `Error fetching logs: ${message}`, providerName);
    }
}

function getLoadingHtml(name: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
          padding: 20px;
          color: var(--vscode-foreground, #cccccc);
          background-color: var(--vscode-editor-background, #1e1e1e);
        }
        .loading {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
        }
        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--vscode-foreground, #ccc);
          border-top: 2px solid transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <h2>${escapeHtml(name)}</h2>
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading logs...</span>
      </div>
    </body>
    </html>`;
}

function getLogsHtml(name: string, logs: string, provider: ProviderName): string {
    const providerIcon = provider === 'Vercel' ? '[V]' : provider === 'Coolify' ? '[C]' : '[N]';
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
          padding: 20px;
          color: var(--vscode-foreground, #cccccc);
          background-color: var(--vscode-editor-background, #1e1e1e);
        }
        h2 {
          margin-bottom: 4px;
        }
        .provider-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          background-color: var(--vscode-badge-background, #4d4d4d);
          color: var(--vscode-badge-foreground, #ffffff);
          margin-bottom: 16px;
        }
        pre {
          background-color: var(--vscode-textCodeBlock-background, #2d2d2d);
          padding: 16px;
          border-radius: 6px;
          overflow-x: auto;
          font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }
      </style>
    </head>
    <body>
      <h2>${escapeHtml(name)}</h2>
      <span class="provider-badge">${providerIcon} ${escapeHtml(provider)}</span>
      <pre>${escapeHtml(logs)}</pre>
    </body>
    </html>`;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
