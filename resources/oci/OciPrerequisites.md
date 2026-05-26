# OCI Layout Prerequisites

The **OCI Layout Explorer** lets you export images from the Docker daemon — or pull them directly from a registry — into an [OCI image layout](https://github.com/opencontainers/image-spec/blob/main/image-layout.md) on disk so you can inspect their manifests, configs, and layers.

To do that, the extension needs **[ORAS](https://oras.land/) on your `PATH`**:

| Operation | Tool used | Why |
| --- | --- | --- |
| **Export from Docker daemon** | `docker save` + `oras cp --from-oci-layout …` | `docker save` only produces a Docker archive (a tar of Docker-specific JSON). ORAS converts that archive into an OCI image layout. |
| **Copy directly from a registry** | `oras cp --recursive … --to-oci-layout …` | ORAS copies images from any OCI-compliant registry straight into an OCI image layout. |

If you only need to **view** an existing OCI layout folder on disk, no extra tool is required — the Docker daemon is not involved.

## Installing ORAS

Pick the option that matches your platform:

- **Official downloads & instructions:** <https://oras.land/docs/installation>
- **Homebrew (macOS / Linux):** `brew install oras`
- **Winget (Windows):** `winget install oras-project.oras`
- **Scoop (Windows):** `scoop install oras`
- **Chocolatey (Windows):** `choco install oras`

After installing, make sure `oras` is on your `PATH`. You can confirm with:

```sh
oras version
```

> If you just installed ORAS, you may need to reload the VS Code window (`Developer: Reload Window`) so the new `PATH` entry is picked up.

## Why does this matter?

Docker's `docker save` format predates the OCI image-layout spec and is not directly compatible with it. Tooling that wants an OCI layout — including this extension's **OCI Layout Explorer** view — needs a converter. ORAS is the standard CNCF tool for that conversion and also supports pulling images directly from any OCI-compliant registry into an OCI image layout.
