import { coolifyProvider } from './coolifyProvider';
import { netlifyProvider } from './netlifyProvider';
import { ProviderAdapter, ProviderName } from './providerTypes';
import { vercelProvider } from './vercelProvider';

const providers: Record<ProviderName, ProviderAdapter> = {
    Vercel: vercelProvider,
    Coolify: coolifyProvider,
    Netlify: netlifyProvider,
};

export function getProvider(name: ProviderName): ProviderAdapter {
    return providers[name];
}

export function getProviders(names: ProviderName[]): ProviderAdapter[] {
    return names.map((name) => providers[name]);
}

export const ALL_PROVIDERS: ProviderName[] = ['Vercel', 'Coolify', 'Netlify'];
