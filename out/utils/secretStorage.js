"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretStorageManager = void 0;
/**
 * Wrapper around VSCode SecretStorage for secure credential management.
 * Tokens are never written to plain configuration files.
 */
class SecretStorageManager {
    constructor(secrets) {
        this.secrets = secrets;
    }
    /** Initialize the singleton instance with the extension context secrets. */
    static initialize(secrets) {
        SecretStorageManager.instance = new SecretStorageManager(secrets);
        return SecretStorageManager.instance;
    }
    /** Get the singleton instance. */
    static getInstance() {
        if (!SecretStorageManager.instance) {
            throw new Error('SecretStorageManager not initialized. Call initialize() first.');
        }
        return SecretStorageManager.instance;
    }
    /** Store a secret value. */
    async store(key, value) {
        await this.secrets.store(key, value);
    }
    /** Retrieve a secret value. Returns undefined if not found. */
    async get(key) {
        return this.secrets.get(key);
    }
    /** Delete a secret value. */
    async delete(key) {
        await this.secrets.delete(key);
    }
    /** Check if a secret exists. */
    async has(key) {
        const value = await this.secrets.get(key);
        return value !== undefined && value !== '';
    }
}
exports.SecretStorageManager = SecretStorageManager;
//# sourceMappingURL=secretStorage.js.map