import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { VercelClient } from '../clients/vercelClient';
import { SecretStorageManager } from '../utils/secretStorage';
import { ProjectInfo, StorageKeys, VercelDeployment, VercelDeploymentEvent } from '../utils/types';
import {
    ProviderAdapter,
    ProviderOperationContext,
    ProviderProjectRef,
    ProviderStatusUpdate,
} from './providerTypes';

const POLL_INTERVAL_MS = 4000;
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1000;

class VercelProviderAdapter implements ProviderAdapter {
    readonly provider = 'Vercel' as const;

    async findExistingProject(project: ProjectInfo): Promise<ProviderProjectRef | null> {
        const client = new VercelClient();
        const existing = await client.findProjectByNameOrRepo(project.name, project.repoUrl);
        return existing ? { id: existing.id, name: existing.name } : null;
    }

    async createProject(project: ProjectInfo): Promise<void> {
        const client = new VercelClient();
        const gitRepo = project.repoOwner && project.repoName
            ? { type: 'github', repo: `${project.repoOwner}/${project.repoName}` }
            : undefined;
        const created = await client.createProject(project.name, gitRepo);

        const deployment = await client.deployProjectFromGit(created.id, created.name, {
            branch: project.branch,
            target: 'production',
        });

        const deploymentId = deployment.uid || deployment.id;
        if (!deploymentId) {
            throw new Error('Vercel did not return a deployment ID after creating the project.');
        }

        const silentProgress: vscode.Progress<{ message?: string; increment?: number }> = {
            report: () => undefined,
        };
        await this.waitForDeployment(client, deploymentId, created.name, silentProgress);
    }

    async listProjects(): Promise<ProviderProjectRef[]> {
        const client = new VercelClient();
        const projects = await client.listProjects();
        return projects.map((project) => ({ id: project.id, name: project.name }));
    }

    async getLogs(projectId: string): Promise<string> {
        const client = new VercelClient();
        const deployments = await client.listDeployments(projectId, 5);
        if (deployments.length === 0) {
            return 'No deployments found for this project.';
        }

        const lines: string[] = [];
        for (const deployment of deployments) {
            const date = new Date((deployment.createdAt ?? deployment.created ?? Date.now()) > 10_000_000_000
                ? (deployment.createdAt ?? deployment.created ?? Date.now())
                : (deployment.createdAt ?? deployment.created ?? Date.now()) * 1000).toLocaleString();
            lines.push(`--- Deployment ${deployment.uid.substring(0, 8)} ---`);
            lines.push(`  URL:     ${deployment.url || 'N/A'}`);
            lines.push(`  State:   ${this.getState(deployment)}`);
            lines.push(`  Created: ${date}`);
            lines.push(`  Source:  ${deployment.source || 'N/A'}`);
            lines.push('');
        }
        return lines.join('\n');
    }

    async redeploy(target: ProviderProjectRef, context: ProviderOperationContext): Promise<{ deploymentUrl?: string }> {
        if (!context.projectPath) {
            throw new Error('Workspace folder is required to run Vercel CLI deploy.');
        }

        const rawToken = await SecretStorageManager.getInstance().get(StorageKeys.VERCEL_TOKEN);
        const token = rawToken?.trim().replace(/^['"]+|['"]+$/g, '');
        if (!token) {
            throw new Error('Vercel API token not found.');
        }

        this.reportStatus(context, {
            phase: 'info',
            message: 'Starting Vercel CLI deploy...',
            sourceLabel: '>_ vercel deploy',
        });

        return new Promise((resolve, reject) => {
            const isWin = process.platform === 'win32';
            const command = `npx --yes vercel@latest deploy --prod --yes --token ${token}`;
            const child = isWin
                ? spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: context.projectPath, windowsHide: true })
                : spawn('npx', ['--yes', 'vercel@latest', 'deploy', '--prod', '--yes', '--token', token], {
                    cwd: context.projectPath,
                });

            let combinedOutput = '';
            let deploymentUrl: string | undefined;
            let hasReportedUploading = false;
            let hasReportedDeploying = false;

            child.stdout.on('data', (data) => {
                const text = data.toString();
                combinedOutput += text;

                const urlMatch = text.match(/https:\/\/[^\s]+\.vercel\.app/);
                if (urlMatch) {
                    deploymentUrl = urlMatch[0].trim();
                }

                if (!hasReportedUploading) {
                    hasReportedUploading = true;
                    this.reportStatus(context, {
                        phase: 'uploading',
                        message: 'Uploading files...',
                        sourceLabel: '>_ vercel deploy',
                    });
                }
            });

            child.stderr.on('data', (data) => {
                const text = data.toString();
                combinedOutput += text;

                if (!hasReportedDeploying) {
                    hasReportedDeploying = true;
                    this.reportStatus(context, {
                        phase: 'deploying',
                        message: 'Building deployment...',
                        sourceLabel: '>_ vercel deploy',
                    });
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    this.reportStatus(context, {
                        phase: 'ready',
                        message: 'Deployment ready.',
                        sourceLabel: '>_ vercel deploy',
                    });

                    if (!deploymentUrl) {
                        const allUrls = combinedOutput.match(/https:\/\/[^\s]+\.vercel\.app/g);
                        if (allUrls && allUrls.length > 0) {
                            deploymentUrl = allUrls[allUrls.length - 1];
                        }
                    }
                    resolve({ deploymentUrl });
                } else {
                    const compactOutput = combinedOutput.replace(/\r/g, '').trim();
                    const maxErrorChars = 5000;
                    const clipped = compactOutput.length > maxErrorChars
                        ? `...[truncated]\n${compactOutput.slice(compactOutput.length - maxErrorChars)}`
                        : compactOutput;
                    reject(new Error(`Vercel CLI exited with code ${code}. Output: ${clipped}`));
                }
            });

            child.on('error', (err) => {
                reject(new Error(`Failed to start Vercel CLI: ${err.message}`));
            });
        });
    }

    private async waitForDeployment(
        client: VercelClient,
        deploymentId: string,
        projectName: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        onStatus?: (update: ProviderStatusUpdate) => void
    ): Promise<VercelDeployment> {
        const startedAt = Date.now();
        let lastEmittedSignature = '';

        while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
            try {
                const deployment = await client.getDeployment(deploymentId);
                const events = await this.getDeploymentEventsSafe(client, deploymentId);
                const state = this.getState(deployment);
                const statusUpdate = this.buildStatusUpdate(deployment, events);
                const signature = `${statusUpdate.phase}|${statusUpdate.state ?? ''}|${statusUpdate.message}|${statusUpdate.sourceLabel ?? ''}`;
                if (signature !== lastEmittedSignature) {
                    lastEmittedSignature = signature;
                    progress.report({
                        message: `${statusUpdate.message} (${this.formatElapsed(startedAt)})`,
                    });
                    onStatus?.({
                        ...statusUpdate,
                        timestamp: Date.now(),
                    });
                }

                if (state === 'READY') {
                    return deployment;
                }

                if (state === 'ERROR' || state === 'CANCELED') {
                    const reason = this.extractFailureReason(deployment, events) || 'No failure reason returned by Vercel.';
                    throw new Error(`Vercel deployment failed (${state}) for "${projectName}": ${reason}`);
                }
            } catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                const elapsedMs = Date.now() - startedAt;

                if (elapsedMs < 30000 && /404|not found/i.test(text)) {
                    const message = `Waiting for deployment details... (${this.formatElapsed(startedAt)})`;
                    progress.report({ message });
                    onStatus?.({
                        phase: 'queued',
                        state: 'QUEUED',
                        message: 'Waiting for deployment details...',
                        timestamp: Date.now(),
                    });
                    await this.sleep(POLL_INTERVAL_MS);
                    continue;
                }

                if (this.isTransientPollingError(text)) {
                    const message = `Temporary Vercel API issue. Retrying... (${this.formatElapsed(startedAt)})`;
                    progress.report({ message });
                    onStatus?.({
                        phase: 'info',
                        message: 'Temporary Vercel API/network issue. Retrying status check...',
                        timestamp: Date.now(),
                    });
                    await this.sleep(POLL_INTERVAL_MS);
                    continue;
                }

                throw error;
            }

            await this.sleep(POLL_INTERVAL_MS);
        }

        throw new Error(`Timed out waiting for Vercel deployment to complete for "${projectName}".`);
    }

    private reportStatus(context: ProviderOperationContext, update: ProviderStatusUpdate): void {
        context.progress.report({ message: update.message });
        context.onStatus?.({
            ...update,
            timestamp: Date.now(),
        });
    }

    private getState(deployment: VercelDeployment): string {
        const state = deployment.state ?? deployment.readyState ?? 'QUEUED';
        return String(state).toUpperCase();
    }

    private async getDeploymentEventsSafe(client: VercelClient, deploymentId: string): Promise<VercelDeploymentEvent[]> {
        try {
            return await client.getDeploymentEvents(deploymentId, { limit: 80, direction: 'backward' });
        } catch {
            return [];
        }
    }

    private buildStatusUpdate(
        deployment: VercelDeployment,
        events: VercelDeploymentEvent[]
    ): ProviderStatusUpdate {
        const state = this.getState(deployment);
        const sourceLabel = this.extractSourceLabel(deployment);
        const recentEvents = this.getRecentEvents(events);
        const uploadProgress = this.extractUploadProgress(recentEvents);

        if (uploadProgress) {
            return {
                phase: 'uploading',
                state,
                message: `Uploading... ${uploadProgress.uploaded}/${uploadProgress.total} files`,
                fileProgress: uploadProgress,
                sourceLabel,
            };
        }

        if (this.hasUploadEvent(recentEvents)) {
            return {
                phase: 'uploading',
                state,
                message: 'Uploading files...',
                sourceLabel,
            };
        }

        if (deployment.isInSystemBuildsQueue || deployment.isInConcurrentBuildsQueue || state === 'QUEUED') {
            return {
                phase: 'queued',
                state,
                message: 'Queued in Vercel build queue...',
                sourceLabel,
            };
        }

        if (state === 'INITIALIZING') {
            return {
                phase: 'deploying',
                state,
                message: 'Initializing deployment...',
                sourceLabel,
            };
        }

        if (state === 'BUILDING') {
            return {
                phase: 'deploying',
                state,
                message: 'Deploying...',
                sourceLabel,
            };
        }

        if (state === 'READY') {
            return {
                phase: 'ready',
                state,
                message: 'Deployment ready.',
                sourceLabel,
            };
        }

        if (state === 'ERROR' || state === 'CANCELED') {
            return {
                phase: 'failed',
                state,
                message: `Deployment ${state.toLowerCase()}.`,
                sourceLabel,
            };
        }

        return {
            phase: 'info',
            state,
            message: `Vercel status: ${state}`,
            sourceLabel,
        };
    }

    private extractSourceLabel(deployment: VercelDeployment): string | undefined {
        const creator = deployment.creator;
        const meta = deployment.meta ?? {};
        const candidates: Array<string | undefined> = [
            creator?.githubLogin,
            creator?.username,
            meta.githubCommitAuthorLogin,
            meta.githubCommitAuthorName,
            creator?.email,
            deployment.source,
        ];

        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return `From ${candidate.trim()}`;
            }
        }

        return undefined;
    }

    private extractFailureReason(
        deployment: VercelDeployment,
        events: VercelDeploymentEvent[]
    ): string | null {
        const meta = deployment.meta as Record<string, unknown> | undefined;
        const candidates: Array<unknown> = [
            deployment.errorMessage,
            deployment.readyStateReason,
            deployment.errorCode,
            meta?.error,
            meta?.errorMessage,
            meta?.message,
            this.extractLastEventText(events, /(error|fail|panic|exception|fatal)/i),
            this.extractLastEventText(events),
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }
        return null;
    }

    private extractUploadProgress(events: VercelDeploymentEvent[]): { uploaded: number; total: number } | null {
        for (const event of events) {
            const text = this.extractEventText(event);
            if (!text) {
                continue;
            }

            const match = text.match(/(\d+)\s*\/\s*(\d+)\s*files?/i);
            if (match) {
                const uploaded = Number(match[1]);
                const total = Number(match[2]);
                if (Number.isFinite(uploaded) && Number.isFinite(total) && total > 0) {
                    return { uploaded, total };
                }
            }
        }

        return null;
    }

    private hasUploadEvent(events: VercelDeploymentEvent[]): boolean {
        return events.some((event) => /upload/i.test(this.extractEventText(event) ?? ''));
    }

    private getRecentEvents(events: VercelDeploymentEvent[]): VercelDeploymentEvent[] {
        return [...events]
            .sort((a, b) => {
                const aTime = typeof a.createdAt === 'number' ? a.createdAt : 0;
                const bTime = typeof b.createdAt === 'number' ? b.createdAt : 0;
                return bTime - aTime;
            })
            .slice(0, 8);
    }

    private extractLastEventText(events: VercelDeploymentEvent[], pattern?: RegExp): string | null {
        for (const event of events) {
            const text = this.extractEventText(event);
            if (!text) {
                continue;
            }
            if (!pattern || pattern.test(text)) {
                return text;
            }
        }

        return null;
    }

    private extractEventText(event: VercelDeploymentEvent): string | null {
        const payloadText = this.extractTextFromUnknown(event.payload);
        const infoText = this.extractTextFromUnknown(event.info);
        const rootText = this.extractTextFromUnknown(event);
        const text = payloadText || infoText || rootText;
        if (!text) {
            return null;
        }

        return text.replace(/\s+/g, ' ').trim();
    }

    private extractTextFromUnknown(value: unknown): string | null {
        if (!value) {
            return null;
        }

        if (typeof value === 'string') {
            return value;
        }

        if (typeof value !== 'object') {
            return null;
        }

        const preferredKeys = ['text', 'message', 'error', 'detail', 'status', 'name', 'type', 'reason'];
        const source = value as Record<string, unknown>;
        for (const key of preferredKeys) {
            const candidate = source[key];
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate;
            }
        }

        for (const candidate of Object.values(source)) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate;
            }
        }

        return null;
    }

    private isTransientPollingError(message: string): boolean {
        return /(fetch failed|network|timed out|timeout|econnreset|enotfound|eai_again|socket|und_err|429|503|504)/i.test(message);
    }

    private formatElapsed(startedAt: number): string {
        const totalSeconds = Math.floor((Date.now() - startedAt) / 1000);
        if (totalSeconds < 60) {
            return `${totalSeconds}s`;
        }
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export const vercelProvider: ProviderAdapter = new VercelProviderAdapter();

export function getLatestVercelDeploymentMeta(
    deployment: VercelDeployment | null
): { sha: string | null; timestamp: number } {
    if (!deployment) {
        return { sha: null, timestamp: 0 };
    }

    const sha = extractCommitSha(deployment.meta);
    const raw = deployment.createdAt ?? deployment.created ?? 0;
    const timestamp = raw > 10_000_000_000 ? raw : raw * 1000;
    return { sha, timestamp };
}

function extractCommitSha(meta: Record<string, string> | undefined): string | null {
    if (!meta) {
        return null;
    }

    const directKeys = ['githubCommitSha', 'githubCommitHash', 'githubCommitRef', 'githubCommit'];
    for (const key of directKeys) {
        const value = meta[key];
        if (value && value.length >= 7) {
            return value.toLowerCase();
        }
    }

    for (const value of Object.values(meta)) {
        const match = value.match(/[0-9a-f]{40}/i);
        if (match) {
            return match[0].toLowerCase();
        }
    }

    return null;
}
