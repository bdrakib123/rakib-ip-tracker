# Changelog

## 3.0.0

- Consolidated the secure V2 JSON-file application into the repository root as the only active application.
- Added privacy-compatible legacy tracking/history/statistics/auth route aliases and bounded in-memory request/page aggregates.
- Restored admin-only history retention controls with origin checks and typed confirmation.
- Restored Leaflet 1.9.4 approximate-location mapping when valid coordinates exist.
- Retired the MongoDB integration runner and MongoDB dependency from the active package.
- Unified package metadata, deployment configuration, documentation, tests, and scripts at the root.
