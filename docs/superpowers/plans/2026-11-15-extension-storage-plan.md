# Extension platform: persistent storage — implementation plan

> **For agentic workers:** Implement task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not start the terminal pilot until this branch is merged.

**Goal:** Give extensions key/value storage and declared collections in the host's SQLite database, behind versioned migrations and enforced permissions, plus a host schema version.

**Spec:** `docs/superpowers/specs/2026-11-15-extension-storage-design.md` (read it first; this plan does not repeat its reasoning).

**Branch:** `feat/extension-system`, from `main` after the current extension work is split out.

## Global constraints

- Coding rule: no short-if early returns in TypeScript (use braces).
- One database file. Extension tables and keys are namespaced; extensions never get raw SQL.
- No change in behavior for existing host features in Task 1.
- Failures are logged with extension id and operation name, never values.

## File structure

New:
- `src/bridge/migrations.ts`: the migration runner (`runMigrations(db, scope, list)`), used for host and extension scopes.
- `src/extension-sdk/storage.ts`: `ExtensionStorage` interface, key and collection validation.
- `src/channel/web/extension-storage.ts`: SQLite implementation of `ExtensionStorage` scoped by extension id.
- `test/bridge/migrations.test.ts`, `test/channel/web/extension-storage.test.ts`, `test/channel/web/extension-purge.test.ts`.

Modified:
- `src/bridge/store.ts`: host migrations move out of `migrate()` into the runner (Task 1).
- `src/extension-sdk/index.ts`: manifest `storage` declaration and permission; `createExtensionApi` receives the storage object.
- `src/channel/web/extension-registry.ts`: run extension migrations before `onActivate`; refuse activation on failure.
- `src/bridge/main.ts` or a CLI entry: `extension:list`, `extension:purge`.

## Tasks

### Task 1: Host schema version and migration runner (no behavior change)

**Files:** Create `src/bridge/migrations.ts`, `test/bridge/migrations.test.ts`. Modify `src/bridge/store.ts`.

- [ ] **Step 1: Failing test.** A fresh in-memory DB, run the runner with three steps, expect `PRAGMA user_version` to be 3 and each step run once. Run it again, expect no step to run twice. Add a step that throws; expect rollback and the version unchanged.
- [ ] **Step 2: Run, expect FAIL** (module missing).
- [ ] **Step 3: Implement** `runMigrations(db, { scope, steps })` using `user_version` for the host scope. Each step in a transaction. The baseline rule: if `user_version` is 0 and the existing `sessions` table already has the columns the ad-hoc `migrate()` adds, record the baseline as the number of those steps instead of re-running them.
- [ ] **Step 4: Move** the `ALTER TABLE` checks in `Store.migrate()` into host steps 2…n, keeping the same column definitions.
- [ ] **Step 5: Test a real existing database.** Copy the current dev DB to a temp file, open it with the new `Store`, expect no error and the same rows. Expect `user_version` to equal the baseline.
- [ ] **Step 6: Run `bun test`**, expect all green. Commit: `refactor(db): run host schema changes through a versioned migration runner`.

### Task 2: Extension migrations and the `extension_migrations` table

**Files:** Modify `src/bridge/migrations.ts` (scope = extension id), `src/channel/web/extension-registry.ts`. Test: `test/channel/web/extension-storage.test.ts`.

- [ ] **Step 1: Failing test.** Extension `remote-agent.demo` declares migrations 1 and 2. Activation runs both, records both in `extension_migrations`. A second activation runs neither. A migration 3 that throws leaves the extension refused and version 2 still recorded.
- [ ] **Step 2: Implement.** The loader calls `runMigrations` with the extension's migration list before `onActivate`. Failure logs and skips that extension; startup continues.
- [ ] **Step 3: Downgrade guard.** If the recorded latest version is higher than the code's, refuse activation with a message naming both numbers.
- [ ] **Step 4: Run tests, commit:** `feat(extensions): run per-extension migrations on activation`.

### Task 3: Key/value storage with the permission gate

**Files:** Create `src/extension-sdk/storage.ts`, `src/channel/web/extension-storage.ts`. Modify `src/extension-sdk/index.ts`. Test: `test/channel/web/extension-storage.test.ts`.

- [ ] **Step 1: Failing tests.**
  - `set` then `get` round-trips a JSON object.
  - `get` of a missing key returns `undefined`.
  - `delete` removes it; `keys('prefix:')` lists only matching keys.
  - Two extensions using the same key do not see each other's values.
  - Key `../x` or an empty key throws.
  - A value that is not JSON-serializable throws.
  - An extension whose manifest lacks `storage` gets no `api.storage` object, and calling through it is a TypeError at the call site.
  - A value over 256 KB throws.
- [ ] **Step 2: Implement** the validation (`^[a-z0-9][a-z0-9_.:-]{0,63}$`, colons allowed for prefixes), the table `extension_kv`, and the scoped object. Permission `storage` added to `ExtensionPermission`.
- [ ] **Step 3: Wire** `createExtensionApi(scopeRegistrar(...), { storage })` so the object is attached only when permitted.
- [ ] **Step 4: Run tests, commit:** `feat(extensions): key/value storage behind the storage permission`.

### Task 4: Declared collections

**Files:** Modify `src/extension-sdk/storage.ts`, `src/channel/web/extension-storage.ts`, `src/extension-sdk/index.ts`. Test: extend `extension-storage.test.ts`.

- [ ] **Step 1: Failing tests.**
  - A collection declared in the manifest is created by the migration runner as `ext_<slug>__<name>` with its indexed columns.
  - A collection not declared throws on `collection(name)`.
  - `insert` then `get` returns the doc; `insert` of the same id throws; `upsert` replaces.
  - `query({ where: { owner: 'x' } })` returns only matching rows; a `where` on a non-indexed field throws.
  - `orderBy` on a non-indexed field throws.
  - Indexed fields are stored in their columns and also in `doc`.
- [ ] **Step 2: Implement.** Table creation generated from the manifest's `indexes` map (`text` → `TEXT`, `integer` → `INTEGER`, `boolean` → `INTEGER` 0/1), each index created. Queries built from a fixed set of operators on validated column names, never from user-supplied identifiers.
- [ ] **Step 3: Run tests, commit:** `feat(extensions): declared collections with indexed fields`.

### Task 5: Purge and list commands

**Files:** Create `src/channel/web/extension-admin.ts`, `test/channel/web/extension-purge.test.ts`. Modify the CLI entry used by `bun run`.

- [ ] **Step 1: Failing tests.** `extension:list` reports KV count and row count per collection. `extension:purge <id>` without `--confirm <id>` refuses. With confirm, it drops the extension's collection tables, deletes its KV rows and migration records, and refuses if the extension is currently loaded.
- [ ] **Step 2: Implement** both commands. Purge runs in one transaction. Table drops use the names recorded in the manifest, never a glob.
- [ ] **Step 3: Run tests, commit:** `feat(extensions): list storage footprint and purge an extension's data`.

### Task 6: Docs and verification

- [ ] **Step 1:** Update `docs/superpowers/specs/2026-11-15-extensions-terminal-plugin-design.md` with a pointer to this storage spec, and extend the terminal plugin's README template with a storage section.
- [ ] **Step 2:** `bun run typecheck` clean; `bun test` all green; `bun run build` clean.
- [ ] **Step 3:** Run the bridge against a copy of the dev database, confirm the existing chats and sessions load and `extension:list` shows the terminal extension as having no data yet.
- [ ] **Step 4: Commit:** `docs(extensions): link storage design from the platform spec`.

## Self-review

- Spec coverage: KV (Task 3), collections (Task 4), migrations (Tasks 1–2), enforced permissions (Task 3), lifecycle and purge (Task 5), host schema version (Task 1). Frontend storage is explicitly out (spec Decision 6), so it has no task.
- Risk: Task 1 touches working schema code. It is isolated in its own commit and is verified against a copy of the real database before any extension code depends on it.
