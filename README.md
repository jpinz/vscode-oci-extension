# OCI Layout Explorer

[![CI](https://github.com/jpinz/vscode-oci-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/jpinz/vscode-oci-extension/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/jpinz.oci-layout-explorer?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=jpinz.oci-layout-explorer)

Visual Studio Code extension for exploring OCI image layout folders from both the Explorer tree and a custom editor view.

## Features

- Open an OCI layout folder from the view title action.
- Browse `oci-layout`, `index.json`, manifests, configs, and layers in a linked tree.
- Open an `oci-layout` file in a custom editor that shows descriptor metadata and linked descriptors.
- Open any linked OCI file directly for raw inspection.
- Show raw previews in the VS Code editor using native rendering and JSON folding.
- Browse and export local Docker images as OCI layouts.
- Integrates with the [Container Tools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.container-tools) extension when available.

## Getting Started

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jpinz.oci-layout-explorer), or search for **OCI Layout Explorer** in the Extensions view.

## Development

```sh
# Install dependencies
npm install

# Build (type-check + bundle)
npm run compile

# Watch mode (esbuild + tsc in parallel)
npm run watch

# Lint
npm run lint

# Run unit tests
npm test

# Run VS Code integration tests
npm run test:vscode

# Production bundle
npm run package
```
