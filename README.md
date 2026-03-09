# Deployment Manager - VSCode Extension

A deployment dashboard for Antigravity that integrates with Vercel, Coolify, and Netlify.
Manage cloud deployments directly inside your editor.

## Features

- Activity Bar icon for quick access
- Dashboard TreeView + rich Dashboard tab
- Vercel integration: list projects, deploy, redeploy, import `.env`, visit site, view deployment logs
- Coolify integration: list applications, deploy, redeploy, import `.env`, visit site, view logs
- Netlify integration: list sites, deploy, redeploy, import `.env`, visit site, view deploy/build logs
- Per-provider resource section refresh in Managed Resources (refresh only that section)
- Deploy action always available, with provider selection at deploy time
- Current workspace status shows deployed providers (for example: `Deployed in Netlify, Vercel`)
- GitHub commit watcher with deploy/redeploy prompts
- Secure credential storage via VSCode SecretStorage

## Getting Started

### Prerequisites

- Node.js v18+
- npm v9+

### Install Dependencies

```bash
npm install
```

### Run Locally

1. Open this folder in VSCode / Antigravity
2. Press `F5` to launch the Extension Development Host
3. Click the Deployment Manager icon in the Activity Bar

### Build

```bash
npm run compile
```

### Watch Mode

```bash
npm run watch
```

## Package as VSIX

```bash
npx @vscode/vsce package --allow-missing-repository
```

## Connecting Providers

### Vercel

1. Run `Deployment Manager: Connect Vercel`
2. Enter your Vercel API token

### Coolify

1. Run `Deployment Manager: Connect Coolify`
2. Enter your Coolify instance URL
3. Enter your Coolify API token

### Netlify

1. Run `Deployment Manager: Connect Netlify`
2. Enter your Netlify personal access token

## Commands

- `Deployment Manager: Open Dashboard`
- `Deployment Manager: Connect Vercel`
- `Deployment Manager: Connect Coolify`
- `Deployment Manager: Connect Netlify`
- `Deployment Manager: Deploy Project`
- `Deployment Manager: Redeploy Project`
- `Deployment Manager: Refresh Dashboard`
- `Deployment Manager: Open Deployment Logs`

## Project Structure

```text
src/
|-- extension.ts
|-- clients/
|   |-- vercelClient.ts
|   |-- coolifyClient.ts
|   |-- netlifyClient.ts
|   `-- githubClient.ts
|-- providers/
|   |-- vercelProvider.ts
|   |-- coolifyProvider.ts
|   |-- netlifyProvider.ts
|   `-- providerTypes.ts
|-- services/
|   |-- projectDetector.ts
|   `-- commitWatcher.ts
|-- commands/
|   |-- connectProvider.ts
|   |-- deployProject.ts
|   |-- redeployProject.ts
|   |-- refreshProjects.ts
|   `-- openLogs.ts
|-- views/
|   |-- dashboardProvider.ts
|   |-- dashboardPanel.ts
|   `-- dashboardLauncherProvider.ts
`-- utils/
    |-- secretStorage.ts
    `-- types.ts
```

## License

MIT
