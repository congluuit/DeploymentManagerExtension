# Deployment Manager — VSCode Extension

> A full deployment dashboard for Antigravity that integrates with **Vercel** and **Coolify**.  
> Manage cloud deployments directly inside your editor — no external dashboards needed.

---

## ✨ Features

- **Activity Bar icon** — Always-visible rocket icon in the sidebar
- **Dashboard TreeView** — See your current project, connected providers, remote projects, and actions at a glance
- **Vercel integration** — List projects, deploy, redeploy, view deployment logs
- **Coolify integration** — List applications, deploy, redeploy, view logs
- **Duplicate deploy prevention** — Automatically detects if a project exists remotely (Redeploy only) or is new (Deploy)
- **GitHub commit watcher** — Polls for new commits every 60s and shows deploy/redeploy notifications
- **Secure credential storage** — Tokens stored via VSCode SecretStorage API (never in plain files)

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [npm](https://www.npmjs.com/) (v9+)

### Install Dependencies

```bash
npm install
```

### Run Locally (Development)

1. Open this folder in VSCode / Antigravity
2. Press **F5** to launch the Extension Development Host
3. The **Deployment Manager** icon (🚀) appears in the Activity Bar
4. Click the icon to open the dashboard

### Compile

```bash
npm run compile
```

### Watch Mode

```bash
npm run watch
```

---

## 📦 Package as VSIX

To package the extension for manual installation:

```bash
npx @vscode/vsce package --allow-missing-repository
```

This generates a `.vsix` file in the project root. To install it in Antigravity:

1. Open the command palette (`Ctrl+Shift+P`)
2. Run **Extensions: Install from VSIX...**
3. Select the generated `.vsix` file

---

## 🔑 Connecting Providers

### Vercel

1. Open the command palette → **Deployment Manager: Connect Vercel**
2. Enter your [Vercel API token](https://vercel.com/account/tokens)
3. The token is validated and stored securely

### Coolify

1. Open the command palette → **Deployment Manager: Connect Coolify**
2. Enter your Coolify instance URL (e.g., `https://coolify.example.com`)
3. Enter your Coolify API token
4. The connection is validated and credentials are stored securely

---

## 📋 Available Commands

| Command | Description |
|---------|-------------|
| `Deployment Manager: Connect Vercel` | Connect to Vercel with an API token |
| `Deployment Manager: Connect Coolify` | Connect to Coolify with URL + token |
| `Deployment Manager: Deploy Project` | Deploy current project (first-time only) |
| `Deployment Manager: Redeploy Project` | Redeploy existing project |
| `Deployment Manager: Refresh Projects` | Refresh all project lists |
| `Deployment Manager: Open Deployment Logs` | View deployment logs in a webview |

---

## 🏗️ Project Structure

```
src/
├── extension.ts              # Activation entry point
├── clients/
│   ├── vercelClient.ts       # Vercel REST API client
│   ├── coolifyClient.ts      # Coolify REST API client
│   └── githubClient.ts       # GitHub commits API client
├── services/
│   ├── projectDetector.ts    # Workspace project detection
│   └── commitWatcher.ts      # GitHub commit polling
├── commands/
│   ├── connectProvider.ts    # Connect Vercel / Coolify
│   ├── deployProject.ts      # First deployment
│   ├── redeployProject.ts    # Redeployment
│   ├── refreshProjects.ts    # Refresh project lists
│   └── openLogs.ts           # View deployment logs
├── views/
│   └── dashboardProvider.ts  # TreeView dashboard
└── utils/
    ├── secretStorage.ts      # Secure token storage
    └── types.ts              # Shared interfaces
```

---

## 📝 License

MIT
