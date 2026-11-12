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
