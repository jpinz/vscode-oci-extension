# OCI Layout Explorer

Visual Studio Code extension for exploring OCI image layout folders from both the Explorer tree and a custom editor view.

## Features

- Open an OCI layout folder from the view title action.
- Browse `oci-layout`, `index.json`, manifests, configs, and layers in a linked tree.
- Open an `oci-layout` file in a custom editor that shows descriptor metadata and linked descriptors.
- Open any linked OCI file directly for raw inspection.
- Show raw previews in the VS Code editor using native rendering and JSON folding.

## Development

```sh
npm run lint
npm run compile
npm test
```
