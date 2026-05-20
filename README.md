# vscode-oci-extension

An extension for Visual Studio Code to interactively explore Open Container Initiative (OCI) image layout folders.

## Features

- Open an OCI layout folder from the explorer view title.
- Browse `oci-layout`, `index.json`, manifests, configs, and layers in a linked tree.
- See an interactive details panel that connects descriptors to their related files, similar to the flow on `explore.ggcr.dev`.
- Open any linked OCI file directly from the details panel for raw inspection.

## Development

```sh
npm run lint
npm test
```
