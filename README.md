# OCI Layout Explorer

[![CI](https://github.com/jpinz/vscode-oci-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/jpinz/vscode-oci-extension/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/jpinz.oci-layout-explorer?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=jpinz.oci-layout-explorer)

Visual Studio Code extension for exploring OCI image layout folders from the OCI Explorer view and a custom blob editor.

## Features

- Explore images from one unified `Explore Image` action:
	- Open an existing OCI layout folder
	- Pick an image from the local Docker daemon
	- Enter a full remote registry reference (tag or digest)
- Browse `oci-layout`, `index.json`, indexes, manifests, configs, layers, and attestations in a linked tree.
- Attestation nodes use concise display labels such as `SLSA`, `SBOM (SPDX)`, `SBOM (CycloneDX)`, `Trivy Report`, and `VEX`.
- Open blobs and descriptor files in the custom `OCI Blob Viewer` editor.
- Open linked OCI files directly for raw inspection.
- Use refresh actions on both OCI Layout and Docker Images views.
- Integrates with the [Container Tools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.container-tools) extension when available.

## How It Works

When you choose a daemon or registry image, OCI Layout Explorer materializes an OCI layout directory and opens it in the tree.

Export strategy is selected automatically:

- Registry images:
	- Prefer direct registry copy with `oras cp --recursive ... --to-oci-layout ...`
	- Fall back to `docker pull` + `docker save` + `oras cp --from-oci-layout ... --to-oci-layout ...`
- Docker daemon images:
	- Use `docker save` + `oras cp --from-oci-layout <archive>:latest --to-oci-layout <layout>:latest`

Export metadata is written to `.oci-explorer.json` in each exported layout folder.

## Requirements

- VS Code `^1.120.0`
- For image export functionality, install [ORAS](https://oras.land/).
- For local daemon exploration:
	- Docker daemon access (`docker` CLI)
- For remote registry exploration:
	- `oras` (used for direct registry-to-layout copy)
	- `docker` optional fallback path via `docker pull` + `docker save`

## Getting Started

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=jpinz.oci-layout-explorer), or search for **OCI Layout Explorer** in the Extensions view.

1. Open the **OCI Explorer** activity bar view.
2. Click **Explore Image**.
3. Choose one of:
	 - **Open OCI layout folder**
	 - **Use image from Docker daemon**
	 - **Pull image from registry**
4. The selected/exported layout is opened automatically in **OCI Layout Explorer**.

## Configuration

- `ociExplorer.docker.socketPath`
	- Docker daemon socket path.
	- If empty, uses `DOCKER_HOST` or the platform default.
- `ociExplorer.docker.exportPath`
	- Directory where OCI layouts are exported.
	- If empty, a temporary directory is used.

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
