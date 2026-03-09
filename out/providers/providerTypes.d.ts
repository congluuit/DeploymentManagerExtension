import * as vscode from 'vscode';
import { ProjectInfo } from '../utils/types';
export type ProviderName = 'Vercel' | 'Coolify' | 'Netlify';
export interface ProviderProjectRef {
    id: string;
    name: string;
}
export interface ProviderOperationContext {
    progress: vscode.Progress<{
        message?: string;
        increment?: number;
    }>;
}
export interface ProviderAdapter {
    readonly provider: ProviderName;
    findExistingProject(project: ProjectInfo): Promise<ProviderProjectRef | null>;
    createProject(project: ProjectInfo): Promise<void>;
    listProjects(): Promise<ProviderProjectRef[]>;
    getLogs(projectId: string): Promise<string>;
    redeploy(target: ProviderProjectRef, context: ProviderOperationContext): Promise<{
        deploymentUrl?: string;
    }>;
}
//# sourceMappingURL=providerTypes.d.ts.map