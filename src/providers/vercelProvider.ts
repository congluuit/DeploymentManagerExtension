import * as vscode from 'vscode';
import { VercelClient } from '../clients/vercelClient';
import { ProjectInfo, VercelDeployment } from '../utils/types';
import { ProviderAdapter, ProviderOperationContext, ProviderProjectRef } from './providerTypes';

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
        await client.createProject(project.name, gitRepo);
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
            const date = new Date(deployment.createdAt ?? deployment.created).toLocaleString();
            lines.push(`--- Deployment ${deployment.uid.substring(0, 8)} ---`);
            lines.push(`  URL:     ${deployment.url || 'N/A'}`);
            lines.push(`  State:   ${deployment.state}`);
            lines.push(`  Created: ${date}`);
            lines.push(`  Source:  ${deployment.source || 'N/A'}`);
            lines.push('');
        }
        return lines.join('\n');
    }

    async redeploy(target: ProviderProjectRef, context: ProviderOperationContext): Promise<{ deploymentUrl?: string }> {
        const client = new VercelClient();
        context.progress.report({ message: 'Triggering redeploy request...' });
        const deployment = await client.redeployProject(target.id, target.name);
        const deploymentId = deployment.uid || deployment.id;
        if (!deploymentId) {
            throw new Error('Unable to determine Vercel deployment ID after triggering redeploy.');
        }

        context.progress.report({
            message: `Queued deployment ${deploymentId.slice(0, 8)}. Waiting for build status...`,
        });
        const completed = await this.waitForDeployment(client, deploymentId, target.name, context.progress);
        return { deploymentUrl: completed.url ? `https://${completed.url}` : undefined };
    }

    private async waitForDeployment(
        client: VercelClient,
        deploymentId: string,
        projectName: string,
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<{ state: string; url?: string }> {
        const startedAt = Date.now();

        while (Date.now() - startedAt < DEPLOY_TIMEOUT_MS) {
            try {
                const deployment = await client.getDeployment(deploymentId) as unknown as Record<string, unknown>;
                const state = this.getState(deployment);
                progress.report({
                    message: `Vercel status: ${state} (${this.formatElapsed(startedAt)})`,
                });

                if (state === 'READY') {
                    return {
                        state,
                        url: typeof deployment.url === 'string' ? deployment.url : undefined,
                    };
                }

                if (state === 'ERROR' || state === 'CANCELED') {
                    const reason = this.extractFailureReason(deployment) || 'No failure reason returned by Vercel.';
                    throw new Error(`Vercel deployment failed (${state}) for "${projectName}": ${reason}`);
                }
            } catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                if (Date.now() - startedAt < 30000 && /404|not found/i.test(text)) {
                    progress.report({ message: `Waiting for deployment details... (${this.formatElapsed(startedAt)})` });
                    await this.sleep(POLL_INTERVAL_MS);
                    continue;
                }
                throw error;
            }

            await this.sleep(POLL_INTERVAL_MS);
        }

        throw new Error(`Timed out waiting for Vercel deployment to complete for "${projectName}".`);
    }

    private getState(deployment: Record<string, unknown>): string {
        const state = deployment.state ?? deployment.readyState ?? 'QUEUED';
        return String(state).toUpperCase();
    }

    private extractFailureReason(deployment: Record<string, unknown>): string | null {
        const error = deployment.error as Record<string, unknown> | undefined;
        const meta = deployment.meta as Record<string, unknown> | undefined;
        const candidates: Array<unknown> = [
            error?.message,
            deployment.errorMessage,
            deployment.readyStateReason,
            meta?.error,
            meta?.errorMessage,
            meta?.message,
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return candidate.trim();
            }
        }
        return null;
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
