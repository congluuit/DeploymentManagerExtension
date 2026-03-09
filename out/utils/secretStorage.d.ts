import * as vscode from 'vscode';
/**
 * Wrapper around VSCode SecretStorage for secure credential management.
 * Tokens are never written to plain configuration files.
 */
export declare class SecretStorageManager {
    private static instance;
    private secrets;
    private constructor();
    /** Initialize the singleton instance with the extension context secrets. */
    static initialize(secrets: vscode.SecretStorage): SecretStorageManager;
    /** Get the singleton instance. */
    static getInstance(): SecretStorageManager;
    /** Store a secret value. */
    store(key: string, value: string): Promise<void>;
    /** Retrieve a secret value. Returns undefined if not found. */
    get(key: string): Promise<string | undefined>;
    /** Delete a secret value. */
    delete(key: string): Promise<void>;
    /** Check if a secret exists. */
    has(key: string): Promise<boolean>;
}
//# sourceMappingURL=secretStorage.d.ts.map