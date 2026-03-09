import { VercelDeployment } from '../utils/types';
import { ProviderAdapter } from './providerTypes';
export declare const vercelProvider: ProviderAdapter;
export declare function getLatestVercelDeploymentMeta(deployment: VercelDeployment | null): {
    sha: string | null;
    timestamp: number;
};
//# sourceMappingURL=vercelProvider.d.ts.map