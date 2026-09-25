# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`makexyz-api` is the backend API for a manufacturing marketplace connecting customers with vendors. It is an [AdonisJS](https://adonisjs.com) application written in TypeScript (ESM, `"type": "module"`), using Lucid ORM over PostgreSQL (SQLite for tests), VineJS for validation, and session/token-based auth via `@adonisjs/auth`.

Read `docs/DATABASE_FLOW.md` before touching anything related to projects, quotes, checkout, orders, payments, shipping, or vendor payouts — it documents the full domain lifecycle (Project → Quote → Checkout → Payment → Order → Vendor Acceptance → Production → Shipping → Payout) and the reasoning behind the table separations (e.g. why checkout sessions are separate from orders, why order items are immutable snapshots of quote items, why vendor payouts are separate from customer payments).

Read `docs/VENDOR_ONBOARDING.md` before touching invitations, vendor onboarding, or vendor gating (routing/acceptance/`isStaff`) — it documents the invite → onboarding → review → active flow, the checklists, every endpoint, and the frontend routing rules, and must be updated in the same change as any edit to that flow.

## Commands

- `npm run dev` — start the dev server with HMR (`node ace serve --hmr`)
- `npm run build` — production build (`node ace build`)
- `npm start` — run a built app (`node bin/server.js`)
- `npm test` — run the full Japa test suite (`node ace test`)
- `node ace test --files functional/projects/project_files.spec.ts` — run a single test file
- `node ace test --tags "..."` / `--tests "..."` — filter by tag/name (see `node ace test --help`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` / `npm run format` — ESLint / Prettier (both use shared `@adonisjs/*` configs, not custom rules)
- `node ace migration:run` / `node ace migration:rollback` — run/rollback migrations (also regenerates `database/schema.ts`, see below)
- `node ace make:controller|model|migration|validator|transformer|middleware` — scaffolders, follow existing naming (snake_case files, singular model names)

Tests use suites defined in `adonisrc.ts`: `tests/unit/**` (2s timeout) and `tests/functional/**` (30s timeout). Only `functional` currently has specs. Functional tests use `@japa/api-client` against an in-memory HTTP server, SQLite (`DB_CONNECTION=sqlite` in `.env.test`), and migrate+truncate per test group (see `group.setup`/`group.each.setup` in existing specs — follow that pattern for new suites).

## Architecture: generated schema + hand-written models

This is the single most important pattern in the codebase and is **not** standard AdonisJS/Lucid usage — verify you understand it before editing anything under `app/models/` or `database/`.

- `database/schema.ts` is **auto-generated** by Lucid's schema generator, driven by `node ace migration:run` (it says so in the file header — do not hand-edit it). It contains one `*Schema extends BaseModel` class per table, with `@column()` declarations reflecting the actual migrated columns.
- `database/schema_rules.ts` is a **hand-maintained** companion file that overrides generated TypeScript types for specific columns (e.g. mapping `status`/`role`/`ownerType` string columns to string-literal unions). If you add a new enum-like column, add/update its entry here so `schema.ts` regenerates with the correct union type.
- Real models in `app/models/*.ts` **extend** the generated `*Schema` class (e.g. `class Order extends OrderSchema {}`) and layer on relations, computed getters, and mixins (see `User` composing `withAuthFinder`). Do not redeclare `@column()` fields that already exist on the generated schema — add new columns via a migration, run `node ace migration:run`, then extend the regenerated schema class if you need relations/behavior on top.
- To add a column: write a migration, run it (regenerates `database/schema.ts`), then add the relation/behavior (if any) to the corresponding `app/models/*.ts` file. Editing `database/schema.ts` directly will be silently overwritten on the next migration run.

`.adonisjs/` (both `client/` and `server/`) is also auto-generated (controller/event/listener registries, Tuyau client types) via the `indexEntities()` and `generateRegistry()` hooks in `adonisrc.ts`, which run on dev-server boot. `start/routes.ts` imports controllers from `#generated/controllers` (`.adonisjs/server/controllers.ts`) rather than importing controller files directly — new controllers get picked up automatically; don't hand-edit files under `.adonisjs/`. Note these generated files are currently committed to git — keep them in sync (run the dev server / build once) rather than hand-patching them if they look stale.

## API response conventions

- Controllers return `serialize(...)` (destructured from `HttpContext`), not raw objects/models, for anything that should follow the standard envelope. This is wired up in `providers/api_provider.ts`, which adds `ctx.serialize` via a custom `ApiSerializer` (`@adonisjs/core/transformers`) that wraps all responses as `{ data: ... }`. Use `serialize.withoutWrapping(...)` only when you deliberately want an unwrapped response (existing code does not use this yet).
- Response shaping goes through `app/transformers/*_transformer.ts` classes extending `BaseTransformer` (`@adonisjs/core/transformers`), with a `toObject()`/async `toObject()` method calling `this.pick(...)` or building a plain object. Controllers call `SomeTransformer.transform(model)` and pass the result to `serialize(...)`. Follow this pattern for new endpoints rather than returning models/plain objects directly — it's how field exposure is controlled (e.g. `password` is also excluded at the model level via `@column({ serializeAs: null })` on `User`).
- Routes are versioned under `/v1` (see `start/routes.ts`), grouped by feature (`auth`, `account`, `projects`) with `.prefix()`/`.as()`.

## Auth

- Two guards are configured in `config/auth.ts`: `web` (session-based, `default`, with remember-me tokens) and `api` (`tokensGuard`, DB-backed access tokens). Both are live in the codebase — session login is used by `NewCustomerController` (`auth.use('web').login(user)`), while `AccessTokensController` issues bearer tokens via `User.accessTokens.create(user)`. There isn't a single canonical auth flow yet; check which guard an existing similar endpoint uses before adding a new one, and ask if it's unclear which is intended for a new flow.
- `middleware.auth()` (named middleware in `start/kernel.ts`) protects routes; it accepts an optional `guards` option but existing usages don't pass one, so it authenticates against the default guard resolution.
- `SilentAuthMiddleware` runs globally and calls `ctx.auth.check()` on every request (not just protected ones), so `auth.user`/`auth.check()` state is available even on public routes.
- Import aliases exist in `package.json` for `#policies/*` and `#abilities/*` (Bouncer-style authorization), but `app/policies/` and `app/abilities/` don't exist yet — there's no established authorization pattern beyond route-level `middleware.auth()` and manual `role` checks. Don't invent a policy/ability convention without checking with the user first.
- Similarly, `#services/*`, `#mails/*`, `#events/*`, `#listeners/*` are wired as import aliases and provider slots but have no code yet.

## Validation

- VineJS (`@vinejs/vine`) validators live in `app/validators/*.ts` as exported `vine.create({...})` schemas, named `xValidator`. Controllers call `request.validateUsing(xValidator)`. Follow the existing pattern of factoring shared field rules into small functions (see `email()`/`password()` in `app/validators/user.ts`) when a rule is reused.
- `start/validator.ts` globally configures VineJS date fields to transform into Luxon `DateTime` (not JS `Date`) — Lucid models expect Luxon `DateTime` for `@column.dateTime()` fields, so don't bypass this transform when handling dates.
- Uniqueness checks use `.unique({ table, column })` directly against table/column names (see `signupValidator`, `newCustomerValidator`).

## File storage

- File uploads go through `@adonisjs/drive` (S3-backed, see `config/drive.ts`); the only configured disk is `s3` (`DRIVE_DISK=s3`, private visibility). Storage keys are built as `${S3_FILE_STORAGE_KEY}/${projectUuid}/${fileUuid}.${extname}` — follow this convention for new project-scoped uploads rather than inventing a new key scheme.
- Allowed upload extensions for project files are enumerated in `app/validators/project_file.ts` (`ALLOWED_EXTENSIONS`) — this is a 3D-manufacturing file whitelist (STL, OBJ, STEP, etc.), not a generic upload allowlist.

## Conventions

- Import aliases (`#controllers/*`, `#models/*`, `#validators/*`, etc.) are defined in `package.json` `imports` — always import via these subpath aliases, not relative paths, matching every existing file.
- Model/table names, UUIDs: most domain tables have both an auto-increment `id` (PK/FK) and a separate public-facing `uuid` column (see `User`, `Customer`, `Vendor`, `Project`, `ProjectFile`, `Order`, `Quote`). Use `uuid` when exposing/looking up records externally (route params, transformers), and `id` for internal FKs — follow this split for new tables rather than exposing raw `id`.
- Money columns are stored as `string` (decimal), not `number` — this is intentional (see every schema class: `subtotal`, `tax`, `total`, `amount`, etc. are typed `string`). Don't do floating-point arithmetic on these; treat them as decimal strings.
- Status/enum columns are plain `string`-typed DB columns constrained to TS unions only via `database/schema_rules.ts` (see above) — there is no DB-level enum type management beyond Knex's `.enum()` in the migration itself, so keep the migration's `table.enum(...)` values and the corresponding `schema_rules.ts` union in sync.
- `hot-hook` boundaries in `package.json` are limited to `app/controllers/**` and `app/middleware/*` — HMR during `npm run dev` only hot-reloads those; other changes (models, config, providers) trigger a full restart.

## Dependency version discipline

This project pins fairly recent major versions of its core framework (AdonisJS 7.x, Lucid ORM 22.x, VineJS 4.x, `@adonisjs/auth` 10.x, per `package.json`/`package-lock.json` at time of writing) — notably including AdonisJS v7 features like the built-in `@adonisjs/core/transformers` module, Lucid's schema-generator (`database/schema.ts`), and Tuyau route registry generation, which are newer than what most general AdonisJS knowledge assumes (older docs/examples target v5/v6 patterns like manual serializers, no generated schema, etc.).

Before writing code against any dependency:

1. Treat `package.json`/`package-lock.json` as the source of truth for installed versions — check the actual installed version (e.g. `node_modules/<pkg>/package.json`) rather than assuming.
2. Look at how the dependency is already used elsewhere in this codebase first — this project has already established version-correct patterns (e.g. the schema/model split, `ctx.serialize`, `BaseTransformer`) that should be reused rather than reinvented.
3. Don't apply APIs/conventions from a different major version of AdonisJS (or any other dependency) without verifying they exist in the installed version — if unsure, check the installed package's own types/source or its docs for that exact version.
4. Don't upgrade, downgrade, or add dependencies unless explicitly asked.

## Things to leave alone unless asked

- `database/schema.ts` and everything under `.adonisjs/` — generated, see above.
- Existing migrations — this project already has 24 migrations forming the live schema; modify the schema via new migrations, not by editing historical ones.
- `docs/DATABASE_FLOW.md` — treat as living domain documentation; update it if a change alters the modeled lifecycle, but don't restructure it as part of an unrelated change.
