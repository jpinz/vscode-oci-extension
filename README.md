# OCI Layout Explorer

[![CI](https://github.com/jpinz/vscode-oci-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/jpinz/vscode-oci-extension/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/jpinz.oci-layout-explorer?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=jpinz.oci-layout-explorer)

Visual Studio Code extension for exploring OCI image layout folders from the OCI Explorer view.

## Features

- Explore images from one unified `Explore Image` action:
	- Open an existing OCI layout folder
	- Pick an image from the local Docker daemon
	- Enter a remote registry reference (tag or digest)
- Browse `oci-layout`, `index.json`, indexes, manifests, configs, layers, and attestations in a linked tree.
- Attestation nodes use concise display labels such as `SLSA`, `SBOM (SPDX)`, `SBOM (CycloneDX)`, `Trivy Report`, and `VEX`.
- Customize node labels with the `ociExplorer.customLabels` setting (match by `mediaType`, `predicateType`, and/or `artifactType`).
- Open blobs and descriptor files directly in the VS Code text editor.
- JSON descriptor blobs open as pretty-printed read-only documents through the `oci-explorer-blob:` virtual file system.
- Open linked OCI files directly for raw inspection.
- OCI descriptor files opened as text are detected as JSON (when parseable), support Ctrl/Cmd-click digest navigation to linked blobs, and show digest hover previews.
- Use refresh actions on both OCI Layout and Docker Images views.
- A prerequisite warning surfaces in the OCI Layout view when `oras` is not installed, with a one-click **Show OCI Layout Prerequisites** help page.
- Integrates with the [Container Tools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.container-tools) extension when available.

## How It Works

When you choose a daemon or registry image, OCI Layout Explorer materializes an OCI layout directory and opens it in the tree.

Export strategy is selected automatically:

- Registry images:
	- Use direct registry copy with `oras cp --recursive ... --to-oci-layout ...`
	- Shorthand references are normalized automatically (for example, `nginx:latest` -> `docker.io/library/nginx:latest`)
- Docker daemon images:
	- Use `docker save` + `oras cp --recursive --from-oci-layout <archive>:latest --to-oci-layout <layout>:latest`
	- Attempt multi-platform export first, and retry with a concrete platform only if conversion requires it
	- If `docker save` (or conversion) fails outright, automatically fall back to pulling the same reference directly from its registry with `oras cp`

When `ociExplorer.docker.exportPath` is configured, the intermediate `.tar` produced by `docker save` is written next to the layout (named `<image>.tar`) instead of a temp directory, making repeat exports of the same image faster.

Export metadata is written to `.oci-explorer.json` in each exported layout folder.

## Requirements

- VS Code `^1.120.0`
- For image export functionality, install [ORAS](https://oras.land/).
- For local daemon exploration:
	- Docker daemon access (`docker` CLI)
- For remote registry exploration:
	- `oras` (used for direct registry-to-layout copy)

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
- `ociExplorer.jsonDetectionMaxSizeMB`
	- Maximum file size (in megabytes) for automatic OCI JSON detection and pretty-printing.
	- Default is `8` (8 MB). Files larger than this remain in their default language mode.
- `ociExplorer.customLabels`
	- Custom label rules for OCI nodes in the tree. Each rule may match on `mediaType`, `predicateType`, and/or `artifactType`; the `*` wildcard is supported. The first matching rule wins.
	- Example:

		```jsonc
		"ociExplorer.customLabels": [
			{
				"label": "Custom Attestation",
				"mediaType": "application/vnd.in-toto+json",
				"predicateType": "https://example.com/my-predicate/*"
			},
			{
				"label": "Helm Chart",
				"artifactType": "application/vnd.cncf.helm.config.v1+json"
			}
		]
		```

## Prerequisites Help

If `oras` is missing, OCI Layout Explorer surfaces a warning entry in the OCI Layout view. Clicking it (or running the **OCI Explorer: Show OCI Layout Prerequisites** command) opens a help page with install instructions.

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

## Trademarks and Notices

The activity bar icon is the official Open Container Initiative&trade; logo,
redistributed verbatim from [opencontainers/artwork](https://github.com/opencontainers/artwork)
under the Apache License 2.0. OCI&trade;, Open Container Initiative&trade;,
and the OCI logo are trademarks of The Linux Foundation&reg;. This extension
is an independent community project and is not produced, endorsed, or
sponsored by The Linux Foundation or the Open Container Initiative. See
[NOTICE.md](NOTICE.md) for full attribution and trademark information, and
the [Linux Foundation Trademark Usage](https://www.linuxfoundation.org/legal/trademark-usage)
page for the governing policy.
