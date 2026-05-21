# Change Log

All notable changes to the "oci-layout-explorer" extension will be documented in this file.

## [1.0.4] - 2026-05-21

- Removed `skopeo` from the export pipeline to eliminate tool-specific copy failures and flag compatibility issues.
- Standardized daemon exports on `docker save` + `oras cp --from-oci-layout ...:latest --to-oci-layout ...:latest`.
- Kept direct registry export via `oras cp --recursive` with fallback to `docker pull` + `docker save` + `oras` conversion.
- Updated documentation to reflect ORAS-first requirements and export behavior.

## [1.0.3] - 2026-05-21

- Fixed `skopeo` invocation to avoid incompatible flag combinations during OCI layout export.
- Improved daemon-export handling for referrer preservation scenarios before the ORAS-only pipeline update.
- Refined export fallback behavior and related output messaging.

## [1.0.2] - 2026-05-21

- Fixed `skopeo` export to write tagged OCI layout destinations with explicit `--format oci`, preserving manifest-level attestation content during export.
- Updated attestation display labels to the new title-cased naming (`SLSA`, `SBOM (SPDX)`, `SBOM (CycloneDX)`, `Trivy Report`, `VEX`).
- Updated documentation and tests to match the current export behavior and label wording.

## [1.0.1] - 2026-05-21

- Added `Explore Image` flow in the OCI Explorer view to open a local OCI folder, select a Docker daemon image, or provide a full remote image reference.
- Added direct remote registry exploration/export path to OCI layout using `oras` and improved export metadata handling.

## [1.0.0] - 2026-05-20

- Improved layout load performance by validating descriptor media types before attempting JSON parsing.
- Added loading-state behavior for the OCI tree while parsing large layouts.
- Improved descriptor naming support by recognizing additional image-name annotations.
- Updated publish workflow to set `package.json` version from the release tag.
- Added project repository metadata and GPL-3.0 license files.
- Refreshed documentation with updated feature and installation content.

## [0.0.3] - 2026-05-20

- Added Docker image browsing and export support in OCI Explorer.
- Rewrote core extension implementation in TypeScript.
- Enabled bundling and added CI/publish workflows for release automation.
- Enhanced attestation display labels, including predicate-type labeling and Trivy report labeling.
- Added navigation mode improvements across tree/webview focus and controls.
- Switched raw blob preview handling to use VS Code editor integration.
- Fixed OCI layout context menu gating for Explorer integration.

## [0.0.2] - 2026-05-20

- Added OCI layout context-menu gating and validation in the Explorer.
- Improved OCI label/navigation UX and descriptor categorization.
- Hardened SLSA predicate matching for attestation-related display.

## [0.0.1] - 2026-05-20

- Initial release of OCI Layout Explorer.
- Added interactive OCI layout tree exploration.
- Added friendly OCI descriptor naming and metadata display improvements.
- Added extension release workflow and related release-job fixes.