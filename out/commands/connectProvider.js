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
exports.connectVercel = connectVercel;
exports.connectCoolify = connectCoolify;
exports.connectNetlify = connectNetlify;
const vscode = __importStar(require("vscode"));
const secretStorage_1 = require("../utils/secretStorage");
const types_1 = require("../utils/types");
const vercelClient_1 = require("../clients/vercelClient");
const coolifyClient_1 = require("../clients/coolifyClient");
const netlifyClient_1 = require("../clients/netlifyClient");
/**
 * Connect to Vercel by prompting for an API token.
 * Validates the token and stores it securely.
 */
async function connectVercel() {
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
    const storage = secretStorage_1.SecretStorageManager.getInstance();
    await storage.store(types_1.StorageKeys.VERCEL_TOKEN, token.trim());
    const client = new vercelClient_1.VercelClient();
    const valid = await client.validateToken();
    if (valid) {
        vscode.window.showInformationMessage('Successfully connected to Vercel.');
        return true;
    }
    await storage.delete(types_1.StorageKeys.VERCEL_TOKEN);
    vscode.window.showErrorMessage('Invalid Vercel API token. Please check your token and try again.');
    return false;
}
/**
 * Connect to Coolify by prompting for base URL and API token.
 * Validates the connection and stores credentials securely.
 */
async function connectCoolify() {
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
            }
            catch {
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
    const storage = secretStorage_1.SecretStorageManager.getInstance();
    await storage.store(types_1.StorageKeys.COOLIFY_BASE_URL, baseUrl.trim());
    await storage.store(types_1.StorageKeys.COOLIFY_TOKEN, token.trim());
    const client = new coolifyClient_1.CoolifyClient();
    const valid = await client.validateConnection();
    if (valid) {
        vscode.window.showInformationMessage('Successfully connected to Coolify.');
        return true;
    }
    await storage.delete(types_1.StorageKeys.COOLIFY_BASE_URL);
    await storage.delete(types_1.StorageKeys.COOLIFY_TOKEN);
    vscode.window.showErrorMessage('Failed to connect to Coolify. Please check your URL and token.');
    return false;
}
/**
 * Connect to Netlify by prompting for an API token.
 * Validates the token and stores it securely.
 */
async function connectNetlify() {
    const token = await vscode.window.showInputBox({
        prompt: 'Enter your Netlify personal access token',
        placeHolder: 'nfp_xxxxxxxxxxxx',
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
    const storage = secretStorage_1.SecretStorageManager.getInstance();
    await storage.store(types_1.StorageKeys.NETLIFY_TOKEN, token.trim());
    const client = new netlifyClient_1.NetlifyClient();
    const valid = await client.validateToken();
    if (valid) {
        vscode.window.showInformationMessage('Successfully connected to Netlify.');
        return true;
    }
    await storage.delete(types_1.StorageKeys.NETLIFY_TOKEN);
    vscode.window.showErrorMessage('Invalid Netlify API token. Please check your token and try again.');
    return false;
}
//# sourceMappingURL=connectProvider.js.map