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
exports.openLogs = openLogs;
const vscode = __importStar(require("vscode"));
const vercelClient_1 = require("../clients/vercelClient");
const coolifyClient_1 = require("../clients/coolifyClient");
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
/**
 * Open deployment logs in a Webview panel.
 * Supports both Vercel deployments and Coolify applications.
 */
async function openLogs(provider, projectId, projectName) {
    if (!provider || !projectId) {
        // Prompt user to select
        const storage = secretStorage_1.SecretStorageManager.getInstance();
        const hasVercel = await storage.has(types_1.StorageKeys.VERCEL_TOKEN);
        const hasCoolify = await storage.has(types_1.StorageKeys.COOLIFY_TOKEN);
        if (!hasVercel && !hasCoolify) {
            vscode.window.showErrorMessage('No providers connected. Connect a provider first.');
            return;
        }
        const items = [];
        if (hasVercel) {
            items.push({ label: 'Vercel', description: 'View Vercel deployment logs' });
        }
        if (hasCoolify) {
            items.push({ label: 'Coolify', description: 'View Coolify application logs' });
        }
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a provider to view logs from',
        });
        if (!selected) {
            return;
        }
        provider = selected.label;
        // Get project list and let user select
        if (provider === 'Vercel') {
            const vercel = new vercelClient_1.VercelClient();
            const projects = await vercel.listProjects();
            const projectPick = await vscode.window.showQuickPick(projects.map((p) => ({ label: p.name, description: p.id, id: p.id })), { placeHolder: 'Select a Vercel project' });
            if (!projectPick) {
                return;
            }
            projectId = projectPick.id;
            projectName = projectPick.label;
        }
        else {
            const coolify = new coolifyClient_1.CoolifyClient();
            const apps = await coolify.listApplications();
            const appPick = await vscode.window.showQuickPick(apps.map((a) => ({ label: a.name, description: a.uuid, id: a.uuid })), { placeHolder: 'Select a Coolify application' });
            if (!appPick) {
                return;
            }
            projectId = appPick.id;
            projectName = appPick.label;
        }
    }
    const displayName = projectName || projectId;
    // Create Webview panel
    const panel = vscode.window.createWebviewPanel('deploymentLogs', `Logs: ${displayName}`, vscode.ViewColumn.One, { enableScripts: true });
    panel.webview.html = getLoadingHtml(displayName);
    try {
        let logsContent = '';
        if (provider === 'Vercel') {
            const vercel = new vercelClient_1.VercelClient();
            const deployments = await vercel.listDeployments(projectId, 5);
            if (deployments.length === 0) {
                logsContent = 'No deployments found for this project.';
            }
            else {
                const lines = [];
                for (const d of deployments) {
                    const date = new Date(d.created).toLocaleString();
                    lines.push(`─── Deployment ${d.uid.substring(0, 8)} ───`);
                    lines.push(`  URL:     ${d.url || 'N/A'}`);
                    lines.push(`  State:   ${d.state}`);
                    lines.push(`  Created: ${date}`);
                    lines.push(`  Source:  ${d.source || 'N/A'}`);
                    lines.push('');
                }
                logsContent = lines.join('\n');
            }
        }
        else if (provider === 'Coolify') {
            const coolify = new coolifyClient_1.CoolifyClient();
            logsContent = await coolify.getApplicationLogs(projectId);
            if (!logsContent) {
                logsContent = 'No logs available for this application.';
            }
        }
        panel.webview.html = getLogsHtml(displayName, logsContent, provider);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        panel.webview.html = getLogsHtml(displayName, `Error fetching logs: ${message}`, provider || 'Unknown');
    }
}
function getLoadingHtml(name) {
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
      <h2>📋 ${escapeHtml(name)}</h2>
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading logs...</span>
      </div>
    </body>
    </html>`;
}
function getLogsHtml(name, logs, provider) {
    const providerIcon = provider === 'Vercel' ? '▲' : '🧊';
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
      <h2>📋 ${escapeHtml(name)}</h2>
      <span class="provider-badge">${providerIcon} ${escapeHtml(provider)}</span>
      <pre>${escapeHtml(logs)}</pre>
    </body>
    </html>`;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
//# sourceMappingURL=openLogs.js.map