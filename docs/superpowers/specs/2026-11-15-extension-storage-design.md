# Extension platform: persistent storage — design

Date: 2026-11-15
Status: approved 2026-11-15; ready to implement after the branch split
Branch (proposed): `feat/extension-system` (the platform only; no pilot code)
Builds on: [Extension system + terminal plugin](2026-11-15-extensions-terminal-plugin-design.md) (its Decisions 1–10 still hold)
Pilot that depends on this: [Terminal sessions](2026-11-15-terminal-sessions-design.md)

## Intent

An extension that has to remember things across restarts (a terminal's session list, a bookmark plugin's folders, a snippet library) needs a place to keep them. Like WordPress plugins using `wp_options` and their own tables, an extension should store data in the same database the host uses, under rules that keep extensions from breaking each other or the host.

This spec adds that storage to the platform. It does not add a terminal feature.

## Facts this design is built on

- The host already has one SQLite file (`REMOTE_AGENT_DB`, default `~/.local/state/remote-agent/bridge.db`). The bridge `Store` (sessions, prompts, instructions, source claims) and the web `ChatLog` (chats, messages, events, drafts, read cursors) open the same file.
- Schema is created with `CREATE TABLE IF NOT EXISTS` plus one-off `ALTER TABLE` checks in `Store.migrate()`. There is no schema version, so nothing can say "this database is at version 7."
- Extensions run in-process (Decision 1 of the platform spec). There is no isolation boundary, so storage rules are about discipline and blast radius, not a security sandbox. The host should still refuse what it can refuse cheaply.

## Goals

- Every extension gets **key/value storage** (`get`, `set`, `delete`, `list`) for small settings and state. Values are JSON.
- Every extension may declare **collections**: small tables with typed indexed fields, created and migrated by the host, with JSON documents as the stored value.
- The host runs **versioned migrations** per extension, recorded in the database, so an extension upgrade can change its schema safely.
- Extension data is **namespaced** so extensions cannot read or write each other's tables or keys, and cannot touch the host's tables.
- The host gets a **schema version** (`PRAGMA user_version`) and a single migration runner, so the host's own tables move through the same mechanism.
- Data survives extension removal. Deleting data is an explicit `purge` command.

## Non-goals (v1)

- Raw SQL for extensions. Extensions use key/value and collections only. A raw-SQL permission (`db-raw`) can come later if a real need appears, and it would be opt-in.
- Cross-extension data sharing. If two extensions need the same data, one owns it and exposes it through its routes.
- Encryption at rest, per-user data partitioning, or multi-tenant isolation. The host is single-user (one allowlisted login).
- Sync to other machines, or backup/restore beyond the database file.

## Anti-goals

- An extension reading or writing `chats`, `messages`, `sessions`, or any other host table through the storage API. The host's tables are not extension data.
- An extension choosing its own table names or reaching into another extension's namespace.
- A storage write that bypasses the `storage` permission check.

## Decisions

**1. One database, two storage shapes for extensions.** Extensions share the host's SQLite file. Two shapes:

- `extension_kv(extension_id, key, value, updated_at)`, primary key `(extension_id, key)`. `value` is JSON text. Used for settings and small state.
- Collections: one table per `(extension, collection)`, named `ext_<extension-slug>__<collection>`, where `<extension-slug>` is the id lowercased with non-alphanumerics replaced by `_` (`remote-agent.terminal` → `ext_remote_agent_terminal`). Every row has `id TEXT PRIMARY KEY`, `doc TEXT NOT NULL` (JSON), `created_at`, `updated_at`, plus the **indexed fields** the extension declares. Indexed fields are typed as `text`, `integer`, or `boolean` and get an index each.

Why not raw SQL: the host can then name, create, migrate, and index the tables itself, which keeps the extension out of the host's tables without a SQL parser. Why not one generic `extension_documents` table for everything: indexed queries across unrelated collections get slow and awkward, and it is harder to see what an extension stored.

**2. Declaring storage in the manifest.** `plugin.json` gains:

```json
{
  "permissions": ["pty", "websocket-routes", "storage"],
  "storage": {
    "collections": {
      "sessions": {
        "indexes": { "owner": "text", "project": "text", "closedAt": "integer" }
      }
    }
  }
}
```

The `storage` permission is required to use any storage API. `storage.collections` is optional; an extension with only KV does not declare it. Collections and migrations are both declared in code, not in the manifest — see Decision 3.

**3. Migrations in code.** An extension's backend module exports a migration list:

```ts
export const migrations = [
  { version: 1, up: (db) => { /* create collections via the storage API */ } },
  { version: 2, up: (db) => { /* ... */ } },
]
```

Rules:
- The host runs migrations in version order, each in its own transaction, and records `(extension_id, version, applied_at)` in `extension_migrations`.
- A version runs once. A failed migration rolls back and the extension is refused activation; startup continues (platform Decision 8).
- Versions are integers, strictly increasing, starting at 1. The host refuses a manifest whose latest applied version is higher than the code's (downgrade).
- The `db` handle passed to `up` is the scoped storage API only: `createCollection`, `addIndex`, `addField`, plus `kv` access. No raw SQL.

Collections the code declares but a migration did not create are an error at activation, not silently created.

**4. The host's own schema versioning.** Host tables keep working as they do, but their creation moves into a host migration list run by the same runner, with `PRAGMA user_version` as the host's version. Existing databases are treated as version = the number of today's ad-hoc steps (baseline), so nothing is re-created. The `ALTER TABLE` checks in `Store.migrate()` become host migration 2…n.

This is a refactor of working code. It is in scope because extensions depend on it, but it lands as its own commit with no behavior change, before any extension storage is added.

**5. Scoped storage API (backend).** Added to the extension's `ExtensionBackendApi`, only when the manifest lists `storage`:

```ts
api.storage.get<T>(key: string): T | undefined
api.storage.set(key: string, value: unknown): void
api.storage.delete(key: string): void
api.storage.keys(prefix?: string): string[]
api.storage.collection(name: string): Collection
// Collection:
c.insert(id, doc, indexed?)  c.upsert(id, doc, indexed?)  c.get(id)
c.delete(id)  c.query({ where?, orderBy?, limit? })
```

- Keys and collection names are validated: `^[a-z0-9][a-z0-9_.-]{0,63}$`.
- `collection(name)` throws if the name is not declared in the manifest.
- `query` accepts only equality and range filters on declared indexed fields, plus `orderBy` on an indexed field. This keeps every query index-backed and keeps the API small.
- Documents are size-limited (256 KB each) and the store refuses values that are not JSON-serializable.

**6. Frontend.** Extensions do not get storage in the browser. The frontend asks its own backend routes, as the terminal panel already does over WebSocket and HTTP. Browser-side persistence (localStorage) remains a per-viewer convenience, not extension state.

**7. Permissions are enforced.** Platform Decision 10 left enforcement open; this spec settles it for `storage`: an extension without the permission receives no storage object, so the call fails at the call site, not later. The same enforcement pattern is used for `pty` and `websocket-routes` in the terminal pilot.

**8. Data lifecycle.**
- Removing an extension folder does **not** delete its data. Its rows stay, and the extension's migrations stay recorded.
- `remote-agent extension:purge <id>` deletes that extension's KV rows, its collection tables, and its migration records. It asks for confirmation and refuses while the extension is loaded.
- `remote-agent extension:list` shows each extension's data footprint (rows per collection, KV count) so purge is an informed choice.

**9. Backups.** The database file is the backup unit. The host does not add a backup feature in v1; the existing WAL-mode SQLite file is what gets copied.

**10. Failure handling.** A storage error (disk full, locked database) in an extension's call throws to that call. It does not take down the host, and it is logged with the extension id and the operation name, never the value.

## Schema changes (host)

```sql
CREATE TABLE IF NOT EXISTS extension_migrations (
  extension_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  applied_at INTEGER NOT NULL,
  PRIMARY KEY (extension_id, version)
);
CREATE TABLE IF NOT EXISTS extension_kv (
  extension_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,            -- JSON
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (extension_id, key)
);
-- Per collection, created by the migration runner, e.g. for remote-agent.terminal/sessions:
-- CREATE TABLE ext_remote_agent_terminal__sessions (
--   id TEXT PRIMARY KEY, doc TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
--   owner TEXT, project TEXT, closedAt INTEGER        -- declared indexed fields, typed
-- );
-- CREATE INDEX ext_remote_agent_terminal__sessions_owner ON ... (owner);
```

Indexed fields are stored as real columns so the index works. The JSON `doc` holds the full value, so a reader that does not need indexing never touches the columns.

## Open questions

1. **Collections vs raw SQL (decided: collections, for isolation).** If you want extensions to write their own SQL (closer to WordPress's `$wpdb`), the trade-off is that the host can no longer guarantee isolation by construction. My recommendation is collections, with `db-raw` added later only if a real extension needs it.
2. **Purge safety.** Purge refuses while the extension is loaded. Is a typed confirmation (`--confirm <id>`) enough, or do you want an export first?
3. **Branch order (decided: this branch first, then the terminal pilot).**
