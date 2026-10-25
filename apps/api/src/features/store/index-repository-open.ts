import { rmSync } from 'node:fs'

import type { Generated, Kysely } from 'kysely'

import { openDerivedDatabase } from '../../db/connection'

/**
 * THE STORE INDEX'S FILE (`docs/internals/store-scale.md`, "Index storage"): a SQLite database of
 * its own in the cache folder, read through `bun:sqlite` with FTS5. It is derived — every row is
 * rebuilt from the providers — so it has no migrations: a file of another schema version, or one
 * that will not open, is deleted and built again.
 */

/** Bump on any change below: the old file is deleted and rebuilt from the providers. */
export const STORE_INDEX_VERSION = 3

export interface StoreIndexTables {
  meta: { key: string; value: string }
  /** Card fields, one row per package; `card` is the listing as JSON without the person's state. */
  listing: {
    pk: Generated<number>
    kind: string
    id: string
    source_id: string
    source_label: string
    name: string
    display_name: string
    summary: string
    tags_text: string
    components_text: string
    category: string
    trust: string
    featured: number
    recommended: number
    origin: string | null
    publisher: string
    /** `user` or `project` for what was written here, null for what a source offers. */
    authored: string | null
    /** When its version was published (ISO 8601), when the source says. */
    updated_at: string | null
    weight: number
    /** 1 when another source with a higher weight lists the same origin. */
    hidden: Generated<number>
    score: number
    signals: string
    card: string
  }
  listing_component: {
    listing: number
    kind: string
    name: string
    description: string | null
    /** 1 when it was read from a fetched package, not the source's listing. */
    learned: number
  }
  /** The person's installs, job and settings link, for the listings they have any of. */
  listing_state: {
    user_id: string
    kind: string
    id: string
    installed: number
    has_update: number
    active_job: number
    /** `,user,project,`: the scopes it is installed in. */
    scopes: string
    state: string
  }
  source_state: {
    kind: string
    source_id: string
    revision: string
    count: number
    synced_at: string
    error: string | null
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS listing (
  pk INTEGER PRIMARY KEY,
  kind TEXT NOT NULL, id TEXT NOT NULL,
  source_id TEXT NOT NULL, source_label TEXT NOT NULL,
  name TEXT NOT NULL, display_name TEXT NOT NULL, summary TEXT NOT NULL,
  tags_text TEXT NOT NULL, components_text TEXT NOT NULL,
  category TEXT NOT NULL, trust TEXT NOT NULL,
  featured INTEGER NOT NULL, recommended INTEGER NOT NULL,
  origin TEXT, publisher TEXT NOT NULL, authored TEXT, updated_at TEXT,
  weight REAL NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL, signals TEXT NOT NULL, card TEXT NOT NULL,
  UNIQUE (kind, id)
);
CREATE INDEX IF NOT EXISTS listing_by_source ON listing (kind, source_id);
CREATE INDEX IF NOT EXISTS listing_by_origin ON listing (origin) WHERE origin IS NOT NULL;
CREATE INDEX IF NOT EXISTS listing_by_score ON listing (hidden, score DESC, display_name, kind, id);
CREATE TABLE IF NOT EXISTS listing_component (
  listing INTEGER NOT NULL REFERENCES listing (pk) ON DELETE CASCADE,
  kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
  learned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS listing_component_by_listing ON listing_component (listing, kind);
CREATE INDEX IF NOT EXISTS listing_component_by_kind ON listing_component (kind, listing);
CREATE TABLE IF NOT EXISTS listing_state (
  user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
  installed INTEGER NOT NULL, has_update INTEGER NOT NULL, active_job INTEGER NOT NULL,
  scopes TEXT NOT NULL, state TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE TABLE IF NOT EXISTS source_state (
  kind TEXT NOT NULL, source_id TEXT NOT NULL,
  revision TEXT NOT NULL, count INTEGER NOT NULL, synced_at TEXT NOT NULL, error TEXT,
  PRIMARY KEY (kind, source_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS listing_fts USING fts5 (
  name, display_name, tags_text, summary, components_text,
  content = 'listing', content_rowid = 'pk',
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);
CREATE TRIGGER IF NOT EXISTS listing_fts_insert AFTER INSERT ON listing BEGIN
  INSERT INTO listing_fts (rowid, name, display_name, tags_text, summary, components_text)
  VALUES (new.pk, new.name, new.display_name, new.tags_text, new.summary, new.components_text);
END;
CREATE TRIGGER IF NOT EXISTS listing_fts_delete AFTER DELETE ON listing BEGIN
  INSERT INTO listing_fts (listing_fts, rowid, name, display_name, tags_text, summary, components_text)
  VALUES ('delete', old.pk, old.name, old.display_name, old.tags_text, old.summary, old.components_text);
END;
CREATE TRIGGER IF NOT EXISTS listing_fts_update AFTER UPDATE ON listing BEGIN
  INSERT INTO listing_fts (listing_fts, rowid, name, display_name, tags_text, summary, components_text)
  VALUES ('delete', old.pk, old.name, old.display_name, old.tags_text, old.summary, old.components_text);
  INSERT INTO listing_fts (rowid, name, display_name, tags_text, summary, components_text)
  VALUES (new.pk, new.name, new.display_name, new.tags_text, new.summary, new.components_text);
END;
`

function removeFile(file: string) {
  for (const path of [file, `${file}-wal`, `${file}-shm`]) rmSync(path, { force: true })
}

function versionOf(sqlite: ReturnType<typeof openDerivedDatabase>['sqlite']): number | null {
  const table = sqlite
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
    .get()
  if (!table) return null
  const row = sqlite.query("SELECT value FROM meta WHERE key = 'version'").get() as {
    value: string
  } | null
  return row ? Number(row.value) : null
}

/**
 * Open the index at `file` (`:memory:` in tests), deleting a file of another version or one that
 * will not open first. A fresh file has no rows: the Store fills it from its providers.
 */
export function openStoreIndexDatabase(file: string): {
  db: Kysely<StoreIndexTables>
  close: () => Promise<void>
} {
  let opened: ReturnType<typeof openDerivedDatabase<StoreIndexTables>> | null = null
  try {
    opened = openDerivedDatabase<StoreIndexTables>(file)
    const version = versionOf(opened.sqlite)
    if (version !== null && version !== STORE_INDEX_VERSION) throw new Error('stale index')
  } catch {
    opened?.sqlite.close(false)
    if (file !== ':memory:') removeFile(file)
    opened = openDerivedDatabase<StoreIndexTables>(file)
  }
  opened.sqlite.exec(SCHEMA)
  opened.sqlite
    .query("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)")
    .run(String(STORE_INDEX_VERSION))
  return { db: opened.db, close: opened.close }
}
