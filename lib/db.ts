import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

// GoDaddy Node.js Hosting injects these env vars for the managed MySQL instance.
// Locally, set them in .env so `next dev` can connect to a dev database.
const DB_CONFIG = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
};

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS saved_items (
    id          VARCHAR(255) PRIMARY KEY,
    type        VARCHAR(32)  NOT NULL,
    title       TEXT         NOT NULL,
    content     MEDIUMTEXT   NOT NULL,
    source      VARCHAR(255) NOT NULL,
    link        TEXT         NULL,
    saved_at    DATETIME(3)  NOT NULL,
    INDEX idx_saved_at (saved_at)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS user_prefs (
    id                   TINYINT     NOT NULL PRIMARY KEY DEFAULT 1,
    role                 TEXT        NULL,
    priority_topics      JSON        NULL,
    deprioritize_topics  JSON        NULL,
    watchlist            JSON        NULL,
    local_feed_key       VARCHAR(64) NOT NULL DEFAULT 'colorado',
    local_zipcode        VARCHAR(16) NOT NULL DEFAULT '',
    local_city           VARCHAR(255) NOT NULL DEFAULT '',
    local_lat            DOUBLE      NULL,
    local_lon            DOUBLE      NULL,
    theme                VARCHAR(32) NOT NULL DEFAULT 'nightwatch',
    timezone             VARCHAR(64) NOT NULL DEFAULT 'America/Chicago',
    last_updated         DATETIME(3) NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS article_prefs (
    id           TINYINT      NOT NULL PRIMARY KEY DEFAULT 1,
    keywords     JSON         NOT NULL,
    sources      JSON         NOT NULL,
    last_updated DATETIME(3)  NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS newsletter_prefs (
    id           TINYINT      NOT NULL PRIMARY KEY DEFAULT 1,
    open_counts  JSON         NOT NULL,
    feedback     JSON         NOT NULL,
    last_updated DATETIME(3)  NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS newsletter_cache (
    id         VARCHAR(255) PRIMARY KEY,
    summary    JSON         NOT NULL,
    cached_at  BIGINT       NOT NULL,
    INDEX idx_cached_at (cached_at)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS email_classification_cache (
    id             VARCHAR(255) NOT NULL,
    account_email  VARCHAR(255) NOT NULL,
    priority       VARCHAR(8)   NOT NULL,
    summary        TEXT         NOT NULL,
    prompt_hash    VARCHAR(32)  NOT NULL,
    cached_at      BIGINT       NOT NULL,
    PRIMARY KEY (id, account_email),
    INDEX idx_email_cache_cached_at   (cached_at),
    INDEX idx_email_cache_prompt_hash (prompt_hash)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS user_memory (
    id           TINYINT     NOT NULL PRIMARY KEY DEFAULT 1,
    content      MEDIUMTEXT  NOT NULL,
    last_updated DATETIME(3) NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS surface_state (
    surface       VARCHAR(64) NOT NULL PRIMARY KEY,
    last_seen_at  BIGINT      NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS vip_suggestions_cache (
    account_email  VARCHAR(255) NOT NULL PRIMARY KEY,
    suggestions    JSON         NOT NULL,
    computed_at    BIGINT       NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS briefing_cache (
    date         VARCHAR(10) NOT NULL PRIMARY KEY,   -- YYYY-MM-DD in user's tz
    briefing     JSON        NOT NULL,
    generated_at BIGINT      NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS thread_sessions (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    date          VARCHAR(10) NOT NULL UNIQUE,
    generated_at  DATETIME(3) NOT NULL,
    through_line  TEXT        NOT NULL,
    article_count INT         NOT NULL DEFAULT 0
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS threads (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    session_id          INT          NOT NULL,
    label               VARCHAR(255) NOT NULL,
    headline            TEXT         NOT NULL,
    summary             TEXT         NOT NULL,
    trend               VARCHAR(16)  NOT NULL,
    sources             JSON         NOT NULL,
    newsletter_context  TEXT         NULL,
    article_ids         JSON         NOT NULL,
    INDEX idx_threads_label (label),
    INDEX idx_threads_session (session_id),
    FULLTEXT INDEX idx_threads_fts (label, headline, summary),
    CONSTRAINT fk_threads_session FOREIGN KEY (session_id)
      REFERENCES thread_sessions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
];

// Additive column migrations for already-existing tables. MySQL < 8.0.29 has
// no `ADD COLUMN IF NOT EXISTS`, so we ignore "duplicate column" errors and
// let everything else surface.
// (table, column, ALTER statement). Each runs only if the column is absent —
// we look up information_schema first so a transient failure mid-rollout
// doesn't leave the schema half-applied with no recovery path. Repeated boots
// of the same version are no-ops.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "user_prefs",  column: "vip_senders",               ddl: "ALTER TABLE user_prefs ADD COLUMN vip_senders                JSON NULL" },
  { table: "user_prefs",  column: "mute_senders",              ddl: "ALTER TABLE user_prefs ADD COLUMN mute_senders               JSON NULL" },
  { table: "user_prefs",  column: "dismissed_vip_suggestions", ddl: "ALTER TABLE user_prefs ADD COLUMN dismissed_vip_suggestions  JSON NULL" },
  { table: "user_memory", column: "pending_exchanges",         ddl: "ALTER TABLE user_memory ADD COLUMN pending_exchanges JSON NULL" },
  { table: "briefing_cache", column: "tz",                     ddl: "ALTER TABLE briefing_cache ADD COLUMN tz VARCHAR(64) NOT NULL DEFAULT 'UTC'" },
];

interface ColumnRow extends RowDataPacket { cnt: number }

async function columnExists(pool: mysql.Pool, table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<ColumnRow[]>(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows.length > 0 && Number(rows[0].cnt) > 0;
}

let initPromise: Promise<mysql.Pool> | null = null;

async function initSchema(pool: mysql.Pool): Promise<mysql.Pool> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await pool.query(stmt);
  }
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    if (await columnExists(pool, table, column)) continue;
    try {
      await pool.query(ddl);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Still tolerate ER_DUP_FIELDNAME in case of a race between the check
      // and the ALTER (e.g. two concurrent boots).
      if (code !== "ER_DUP_FIELDNAME") throw err;
    }
  }
  return pool;
}

export function getDb(): Promise<mysql.Pool> {
  if (!initPromise) {
    if (!DB_CONFIG.host || !DB_CONFIG.user || !DB_CONFIG.database) {
      return Promise.reject(
        new Error(
          "Database env vars missing (DB_HOST/DB_USER/DB_NAME). " +
            "On GoDaddy these are auto-injected; locally, set them in .env."
        )
      );
    }
    const pool = mysql.createPool(DB_CONFIG);
    initPromise = initSchema(pool).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export default getDb;
