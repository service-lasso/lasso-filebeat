# Packaging

## Canonical reader guidance

Start with [docs/service-authoring/overview.md](https://github.com/service-lasso/service-lasso/blob/develop/docs/service-authoring/overview.md) and [docs/service-authoring/03-create-release-repo.md](https://github.com/service-lasso/service-lasso/blob/develop/docs/service-authoring/03-create-release-repo.md) and [docs/service-authoring/05-validate-release.md](https://github.com/service-lasso/service-lasso/blob/develop/docs/service-authoring/05-validate-release.md). This page retains Filebeat-owned service and packaging contracts. Filebeat remains opt-in; metrics readiness does not prove log ingestion, and output credentials stay outside shared evidence. Migration: [Filebeat #6](https://github.com/service-lasso/lasso-filebeat/issues/6), [Core #1419](https://github.com/service-lasso/service-lasso/issues/1419), reviewed source `5427dd1b5b7ca55b565aae5edf7c6b61bfd2b284`.

The authoritative packager is `scripts/package.mjs`, invoked by `npm run package`. It downloads the selected Elastic Filebeat distribution (or uses `FILEBEAT_VENDOR_ARCHIVE`), copies that distribution into the payload and adds `SERVICE-LASSO-PACKAGE.json` with source/platform metadata. It creates a versioned archive under `dist/`: Windows x64 ZIP, Linux x64 tar.gz or macOS arm64 tar.gz. It does not add `service.json` to the archive; the release manifest remains a separate artifact. Local packaging does not publish a release.

## App Artifact Modes

Service repos publish installable service archives from their own releases.

Apps that consume Service Lasso can then produce two useful runtime artifact modes:
- `runtime` / bootstrap-download: the app ships `services/<service-id>/service.json`, and Service Lasso downloads the service archive from that manifest during install/acquire.
- `bundled`: the app package step has already run Service Lasso package/acquire behavior and stored the service archive under `services/<service-id>/.state/artifacts/<tag>/<assetName>` before the app artifact is published.

Bundled app artifacts should not need a first-run service archive download. The service manifest still remains the source of truth for release metadata; the bundled archive is the already-acquired payload that matches that manifest.
