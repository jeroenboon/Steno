# ADR 0006 — SQLite + hand-rolled forward-only migrations (no ORM)

**Status:** Accepted
**Date:** 2026-06-14
**Item:** 0004

## Context

The app needs durable local storage for meetings, participants, transcript spans, and structured notes. All I/O lives in the main process (ADR 0005). The store must survive crashes mid-meeting (principle #13: autosave every extraction turn, lose at most one turn).

Realistic options:

| Option | Verdict |
|---|---|
| better-sqlite3 + hand-rolled SQL | Chosen |
| better-sqlite3 + Drizzle ORM | Rejected |
| better-sqlite3 + Prisma | Rejected |
| SQLite via sql.js (WASM) | Rejected |

## Decision

Use **better-sqlite3** directly, with numbered `.sql` migration files applied by a small runner at startup.

No ORM.

## Reasoning

**Why better-sqlite3?**
Synchronous API is the right fit for Electron's main process. No async complexity, no thread management. Battle-tested, widely used in Electron apps. Native module; `electron-vite`'s `externalizeDepsPlugin` marks it external so Vite never tries to bundle it.

**Why no ORM (Drizzle, Prisma, TypeORM, etc.)?**

- We need cross-meeting queries with real columns (`owner`, `status`, `due_date`) — the schema is shaped by the domain, not by what an ORM generates easily.
- ORMs add a second schema definition layer; we already have Zod as the single source of truth for domain types. Two schema systems fighting each other is complexity without payoff.
- Prisma requires a separate engine binary and a code-generation step; on Windows + Electron the native rebuild story gets worse, not better.
- The query surface is small and stable (7 tables, known queries). SQL is readable and unambiguous; generated queries are not.
- Future maintainers can read the SQL directly. An ORM obscures what hits the DB.
- This ADR is here to stop someone adding an ORM later without reconsidering the trade-off.

**Why hand-rolled migrations over Flyway/Knex/etc.?**

The runner is ~30 lines. It reads numbered `.sql` files from disk, checks `schema_migrations`, and applies pending ones in a transaction. That covers everything we need. A migration framework adds a dependency for zero additional capability at this scale.

**Why sql.js (WASM) is out?**

sql.js runs SQLite in WASM. In a Node/Electron main process there is no reason to take the WASM detour; the native binding is faster and simpler.

## Consequences

- The DB file lives in `app.getPath('userData')` in production. Tests inject `:memory:`.
- Migrations are forward-only. No rollback. A bad migration requires a new migration to fix it.
- `better-sqlite3` must be rebuilt for the Electron version after any Electron upgrade (`electron-rebuild` or `@electron/rebuild`). This is standard practice for native Electron addons.
- `externalizeDepsPlugin` in `electron.vite.config.ts` ensures `better-sqlite3` is excluded from the Vite bundle and loaded as a Node native module at runtime.
- All repo functions take a `Database` instance as a parameter, keeping them pure and trivially testable with `:memory:` DBs.
