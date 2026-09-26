# Filebeat reader migration

Active documentation scope: Filebeat #6, Core #1419 / #1265, SPEC-002 AC-4AJ.3.

Exactly README.md, docs/service.md and docs/packaging.md gain the recorded central reader destinations. Preserve opt-in service ownership, outputs/credentials and metrics-versus-ingestion boundaries. Preserve existing README/service contracts exactly; replace copied template packaging text with scripts/package.mjs facts at develop 5427dd1b5b7ca55b565aae5edf7c6b61bfd2b284.

Acceptance: all destinations are merged and verified; two component documents unchanged apart from pointers; packaging matches vendor distribution plus metadata and separate manifest; diff and current-head hosted checks pass. Develop-only issue branch/PR; no runtime changes, publication or new installed/provider acceptance. Core #1425 destination must merge before closure.