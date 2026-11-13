# VNG Campus Online

Browser-based multiplayer 3D recreation of VNG Campus with admin-authored daily missions. The plan and technical design live in `docs/` and are written in Vietnamese; reply to the user in Vietnamese.

## Working from the plan

- Work is cut into packages with ids like `P1.2` in `docs/10-roadmap.md`. When asked to "implement P1.2", read that package's row and its phase's acceptance criteria first, then the design doc it touches:
  - world / map-data / assets / avatars → `docs/03-world-and-assets.md`
  - client runtime, rendering, controls, HUD → `docs/04-client.md`
  - rooms, state schema, message protocol → `docs/05-multiplayer.md`
  - mission engine, objectives, rewards → `docs/06-missions.md`
  - DB schema, REST API, auth, jobs → `docs/07-backend-data.md`
  - admin CMS → `docs/08-admin-cms.md`
  - deploy, security, privacy → `docs/09-infra-security.md`
- Stack, repo layout, dependency rules and cross-cutting conventions (units, wire formats, error shape, time zones) are in `docs/02-architecture.md`. Follow them rather than re-deciding.
- Open product decisions D1–D12 and their defaults are in `docs/11-risks-open-questions.md`. Build to the default unless the user has said otherwise.
- After finishing a package: set its status in `docs/10-roadmap.md`, and record anything built differently from the design in `docs/DECISIONS.md` (and fix the design doc itself).

## Commands

- `pnpm dev` runs web (5173), admin (5174), api (3001) and realtime (2567) together.
- `pnpm check` runs lint → typecheck → test → build → smoke, the same chain as CI. Run it before every commit; `pnpm format` fixes formatting.
- One package: `pnpm --filter @campus/realtime test`.
- UI changes are verified by running `pnpm dev` and driving the page in a browser, not by tests alone.
- Cloud sessions render WebGL in software (about 10 FPS at 1400×800), so frame rates measured there mean nothing. Check draw calls and triangle counts instead, and say that real-device FPS is unmeasured.

## How the workspace is built

- Packages in `packages/` export TypeScript source (`exports` → `./src/index.ts`) and have no build step.
- `apps/api` and `apps/realtime` are bundled with tsdown: workspace code is inlined, npm packages stay external. So an npm package imported by a workspace package must also be listed in the dependencies of every app that bundles it. `pnpm smoke` starts the built servers and fails if one is missing.
- `erasableSyntaxOnly` is on: no `enum`, `namespace` or parameter properties. Colyseus state is declared with the `schema({...})` builder from `@colyseus/schema`, not decorators.
- The realtime app depends on `@colyseus/core` directly, not the `colyseus` meta-package.
- Versions used by more than one package live in the `catalog:` of `pnpm-workspace.yaml`.
- The browser only calls its own origin: `/api` (REST) and `/rt` (realtime). Vite proxies both in development.
- Biome does not format Markdown; keep doc tables compact.
- The 3D world is built from map data by `apps/web/src/game/world/buildWorld.ts` (pure three.js, no DOM). Its tests cast rays through the collision mesh; when geometry or the map changes, extend those rather than eyeballing screenshots alone.
- `packages/map-data/src/campus.json` is generated: edit `tools/map-tools/src/campus-v0.ts` and run `pnpm map:build`. A test fails if the committed file is stale. Library code comes from `@campus/map-data`, the campus itself from `@campus/map-data/campus`. `http://localhost:5173/debug/map` shows each floor with coordinates under the cursor.

## Rules that are easy to get wrong

- The server decides mission progress and rewards. The client only sends intents (`move`, `interact`, `quiz:answer`); never add a "client reports completion" path.
- Geography has one source: `packages/map-data`. Client, realtime server and admin all read areas and POIs from it; don't hard-code coordinates elsewhere.
- Per-frame data never goes through React state. Keep it in plain mutable objects read inside `useFrame`.
- `apps/web` and `apps/admin` must not import `packages/core` or `packages/db`.
- Reward grants must stay idempotent (unique key on `wallet_ledger`).
- Chat is not persisted to the database; analytics are aggregate-only. This is a deliberate privacy choice for a workplace app.
- Library versions in the docs are a snapshot from 2026-11-12. Check current versions and docs (especially Colyseus, which is pre-1.0) before scaffolding or using a new API.

## Reference data

- `docs/reference/osm-campus.geojson` — OpenStreetMap extract of the campus with coordinates already converted to the campus-local frame (origin, axis bearing in its `metadata`). © OpenStreetMap contributors, ODbL.
- Internal floor plans or photos the user provides are not to be committed if the repository is public.
