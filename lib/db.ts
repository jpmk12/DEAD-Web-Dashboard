import mysql from "mysql2/promise";

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
const COLUMN_MIGRATIONS: string[] = [
  "ALTER TABLE user_prefs ADD COLUMN vip_senders  JSON NULL",
  "ALTER TABLE user_prefs ADD COLUMN mute_senders JSON NULL",
];

let initPromise: Promise<mysql.Pool> | null = null;

async function initSchema(pool: mysql.Pool): Promise<mysql.Pool> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await pool.query(stmt);
  }
  for (const stmt of COLUMN_MIGRATIONS) {
    try {
      await pool.query(stmt);
    } catch (err) {
      const code = (err as { code?: string }).code;
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
