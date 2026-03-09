import * as vscode from 'vscode';

/**
 * Wrapper around VSCode SecretStorage for secure credential management.
 * Tokens are never written to plain configuration files.
 */
export class SecretStorageManager {
    private static instance: SecretStorageManager;
    private secrets: vscode.SecretStorage;

    private constructor(secrets: vscode.SecretStorage) {
        this.secrets = secrets;
    }

    /** Initialize the singleton instance with the extension context secrets. */
    static initialize(secrets: vscode.SecretStorage): SecretStorageManager {
        SecretStorageManager.instance = new SecretStorageManager(secrets);
        return SecretStorageManager.instance;
    }

    /** Get the singleton instance. */
    static getInstance(): SecretStorageManager {
        if (!SecretStorageManager.instance) {
            throw new Error('SecretStorageManager not initialized. Call initialize() first.');
        }
        return SecretStorageManager.instance;
    }

    /** Store a secret value. */
    async store(key: string, value: string): Promise<void> {
        await this.secrets.store(key, value);
    }

    /** Retrieve a secret value. Returns undefined if not found. */
    async get(key: string): Promise<string | undefined> {
        return this.secrets.get(key);
    }

    /** Delete a secret value. */
    async delete(key: string): Promise<void> {
        await this.secrets.delete(key);
    }

    /** Check if a secret exists. */
    async has(key: string): Promise<boolean> {
        const value = await this.secrets.get(key);
        return value !== undefined && value !== '';
    }
}
