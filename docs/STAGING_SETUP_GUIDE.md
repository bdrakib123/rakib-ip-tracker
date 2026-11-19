# Isolated Staging Setup

No Render service was created or accessed in preparing this guide. Production remains NO-GO.

## Choose the validation tier

1. **Free temporary smoke test:** use `RENDER_FREE_STAGING_GUIDE.md`. It is synthetic-data-only, uses ephemeral storage and loses data on restart/spin-down.
2. **Persistent staging:** create a separate service and a separate disk. Follow `STAGING_SERVICE_CONFIGURATION.md`; do not share production service, disk, secrets, files, hostname, or backups.
3. **Production:** remains blocked until all owner-evidence items in `DEPLOYMENT_READINESS_CHECKLIST.md` pass.

## Persistent staging owner procedure

1. In Render, create a new service from the reviewed repository/branch, name it `rakib-ip-tracker-staging`, leave Root Directory blank, set build `npm ci --omit=dev`, start `npm start`, Node `20.18.1`, health `/healthz`, one instance.
2. Attach a newly created staging-only disk mounted at `/var/data`; confirm its identity and actual size. Use `/var/data/staging/visitors.json` and `/var/data/staging/backups`. Never attach or clone a production disk.
3. Add fresh staging-only `ADMIN_PASSWORD` and `IP_ENCRYPTION_KEY` through protected dashboard secret fields. Configure ordinary variables using `STAGING_SERVICE_CONFIGURATION.md`. Do not copy production environment groups.
4. Restrict access before starting. If the account cannot restrict ingress, do not start a public persistent staging collector without an owner-approved access design.
5. Keep `TRUST_PROXY_HOPS` unresolved until platform evidence and the proxy validation procedure demonstrate the actual chain. Do not assume the current blueprint's value is correct.
6. Have a second operator compare service identity, disk, paths, host, and secret names (not values) against production separation. Record sanitized evidence in `STAGING_OWNER_EVIDENCE_TEMPLATE.md`.
7. Start only after owner approval. Verify `/healthz` and protected storage health. Use synthetic test data only.
8. Verify disk persistence through restart, lock behavior, corrupt-file fail-closed behavior, backup verification and an isolated synthetic restore drill. Never run restore against production storage.
9. Review only sanitized logs; do not export/copy visitor rows, request headers, environment dumps, IPs, or credentials into evidence.
10. Restrict/stop staging after validation. Preserve its disk and lock metadata until an authorized recovery review; never delete a lock based only on age or PID.

## Clean install and tests

Run from the repository root in clean Linux CI:

```sh
npm ci --omit=dev
npm ls --omit=dev --depth=0
npm run check
npm test
npm audit --omit=dev
```

The browser suite additionally needs Playwright Firefox installed in CI. These local commands do not establish Render disk or proxy behavior.
