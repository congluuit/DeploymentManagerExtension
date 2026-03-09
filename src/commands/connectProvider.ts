import * as vscode from 'vscode';
import { SecretStorageManager } from '../utils/secretStorage';
import { StorageKeys } from '../utils/types';
import { VercelClient } from '../clients/vercelClient';
import { CoolifyClient } from '../clients/coolifyClient';

/**
 * Connect to Vercel by prompting for an API token.
 * Validates the token and stores it securely.
 */
export async function connectVercel(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
        prompt: 'Enter your Vercel API token',
        placeHolder: 'vercel_xxxxxxxxxxxx',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'API token is required';
            }
            return null;
        },
    });

    if (!token) {
        return false;
    }

    const storage = SecretStorageManager.getInstance();
    await storage.store(StorageKeys.VERCEL_TOKEN, token.trim());

    // Validate the token
    const client = new VercelClient();
    const valid = await client.validateToken();

    if (valid) {
        vscode.window.showInformationMessage('✅ Successfully connected to Vercel!');
        return true;
    } else {
        await storage.delete(StorageKeys.VERCEL_TOKEN);
        vscode.window.showErrorMessage('❌ Invalid Vercel API token. Please check your token and try again.');
        return false;
    }
}

/**
 * Connect to Coolify by prompting for base URL and API token.
 * Validates the connection and stores credentials securely.
 */
export async function connectCoolify(): Promise<boolean> {
    const baseUrl = await vscode.window.showInputBox({
        prompt: 'Enter your Coolify instance URL',
        placeHolder: 'https://coolify.example.com',
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Base URL is required';
            }
            try {
                new URL(value.trim());
                return null;
            } catch {
                return 'Please enter a valid URL';
            }
        },
    });

    if (!baseUrl) {
        return false;
    }

    const token = await vscode.window.showInputBox({
        prompt: 'Enter your Coolify API token',
        placeHolder: 'API token from Coolify settings',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'API token is required';
            }
            return null;
        },
    });

    if (!token) {
        return false;
    }

    const storage = SecretStorageManager.getInstance();
    await storage.store(StorageKeys.COOLIFY_BASE_URL, baseUrl.trim());
    await storage.store(StorageKeys.COOLIFY_TOKEN, token.trim());

    // Validate the connection
    const client = new CoolifyClient();
    const valid = await client.validateConnection();

    if (valid) {
        vscode.window.showInformationMessage('✅ Successfully connected to Coolify!');
        return true;
    } else {
        await storage.delete(StorageKeys.COOLIFY_BASE_URL);
        await storage.delete(StorageKeys.COOLIFY_TOKEN);
        vscode.window.showErrorMessage('❌ Failed to connect to Coolify. Please check your URL and token.');
        return false;
    }
}
