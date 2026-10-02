# Muse Park — Season 0 site (prototype)

Visuals-first, static Next.js site under `site/`. Every screen is driven by the conformance vectors in `../vectors` through a typed, validating loader (`lib/vectors.ts`). Brier scores, baselines, payouts and bond splits are recomputed with the spec's integer math (`lib/amp.ts`, BigInt only) and checked against the vectors at build time (`lib/derive.ts`). A mismatch fails the build.

Every page carries a permanent banner: **SIMULATED: conformance vectors, public test keys, no real money.**

```bash
cd site
npm ci
npm run typecheck && npm run lint && npm run build && npm test
npm run screenshot          # 380px captures of /reveal (sealed + open, dark + light) and other pages
```

`npm test` runs the copy-rule and banner checks against `out/` too, so run it after `npm run build`.

Notes:
- The "crowd" (closing pool) baseline, floor(YES pool × 10⁶ ÷ total), is site-defined. The spec does not define it yet (OPEN_QUESTIONS #4).
- The site never reads `test_private_key` from `identity.json`.
- Static export (`output: 'export'`): `out/` can be served by any static host.
