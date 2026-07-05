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
  // Daily Force Protection posture per watched entry, for day-over-day deltas
  // ("what changed"). entry_key is stable across edits (country name / base
  // label), not the prefs id (which is timestamped).
  `CREATE TABLE IF NOT EXISTS force_posture_daily (
    day         VARCHAR(10)  NOT NULL,
    entry_key   VARCHAR(160) NOT NULL,
    label       VARCHAR(80)  NOT NULL,
    cocom       VARCHAR(16)  NOT NULL,
    composite   VARCHAR(10)  NOT NULL,
    PRIMARY KEY (day, entry_key)
  ) ENGINE=InnoDB`,
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
    timezone_mode        VARCHAR(16) NOT NULL DEFAULT 'auto',
    sitrep_bases         JSON        NULL,
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

  // Single-row store for cross-device UI state that isn't a "preference" proper
  // (so it stays out of UserPrefs and can't be clobbered by a prefs Save): OSINT
  // dismissed clusters, map provider/layer choices, newsletter quiet-prompt
  // dismissals. Shallow-merged JSON blob keyed by namespaced strings.
  `CREATE TABLE IF NOT EXISTS app_ui_state (
    id         TINYINT      NOT NULL PRIMARY KEY DEFAULT 1,
    state      JSON         NOT NULL,
    updated_at DATETIME(3)  NOT NULL
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

  `CREATE TABLE IF NOT EXISTS files (
    id            VARCHAR(36)  NOT NULL,
    filename      VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(127) NOT NULL,
    size_bytes    BIGINT       NOT NULL,
    description   TEXT         NULL,
    tags          JSON         NULL,
    doc_id        VARCHAR(36)  NULL,
    data          LONGBLOB     NOT NULL,
    uploaded_at   DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_files_uploaded (uploaded_at DESC),
    INDEX idx_files_doc      (doc_id),
    CONSTRAINT fk_files_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS document_versions (
    id           VARCHAR(36)  NOT NULL,
    doc_id       VARCHAR(36)  NOT NULL,
    title        VARCHAR(255) NOT NULL,
    content      MEDIUMTEXT   NOT NULL,
    tags         JSON         NULL,
    saved_at     DATETIME(3)  NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_dv_doc_saved (doc_id, saved_at DESC),
    CONSTRAINT fk_dv_doc FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS osint_triage_cache (
    id           VARCHAR(255) NOT NULL,
    priority     VARCHAR(8)   NOT NULL,
    reason       VARCHAR(120) NOT NULL,
    prompt_hash  VARCHAR(32)  NOT NULL,
    cached_at    BIGINT       NOT NULL,
    PRIMARY KEY (id),
    INDEX idx_osint_cache_cached_at   (cached_at),
    INDEX idx_osint_cache_prompt_hash (prompt_hash)
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

  `CREATE TABLE IF NOT EXISTS news_overview_cache (
    date         VARCHAR(10) NOT NULL PRIMARY KEY,   -- YYYY-MM-DD in user's tz
    tz           VARCHAR(64) NOT NULL DEFAULT 'UTC',
    ctx_hash     VARCHAR(16) NOT NULL DEFAULT '',    -- hash of role/topics/watchlist; mismatch forces re-curate
    payload      JSON        NOT NULL,               -- { critical: NewsItem[], discover: NewsItem[], mode }
    generated_at BIGINT      NOT NULL
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS documents (
    id         VARCHAR(36)  NOT NULL PRIMARY KEY,
    title      VARCHAR(255) NOT NULL,
    content    MEDIUMTEXT   NOT NULL,
    tags       JSON         NOT NULL,
    aliases    JSON         NULL,
    collection VARCHAR(64)  NULL,                       -- one-level grouping; NULL = "No collection"
    doc_type   VARCHAR(16)  NOT NULL DEFAULT 'note',    -- lib/docTypes.ts vocabulary
    props      JSON         NULL,                       -- key:value properties (era, course, …)
    pinned     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at DATETIME(3)  NOT NULL,
    updated_at DATETIME(3)  NOT NULL,
    INDEX idx_documents_updated (updated_at DESC),
    INDEX idx_documents_pinned (pinned),
    FULLTEXT INDEX idx_documents_fts (title, content)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS document_links (
    doc_id       VARCHAR(36)  NOT NULL,
    target_type  VARCHAR(32)  NOT NULL,    -- 'doc' | 'article' | 'email' | 'event'
    target_id    VARCHAR(255) NOT NULL,
    target_title TEXT         NULL,
    relation     VARCHAR(16)  NULL,        -- typed wiki-link: supports | contradicts | …
    note         VARCHAR(500) NULL,        -- free-text annotation from [[Title | rel: note]]
    PRIMARY KEY (doc_id, target_type, target_id),
    INDEX idx_doc_links_target (target_type, target_id),
    CONSTRAINT fk_doc_links_doc FOREIGN KEY (doc_id)
      REFERENCES documents(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS anthropic_usage (
    id                    BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
    route                 VARCHAR(64)  NOT NULL,    -- 'chat' | 'briefing' | 'email_triage' | …
    model                 VARCHAR(64)  NOT NULL,    -- e.g. 'claude-haiku-4-5'
    input_tokens          INT          NOT NULL DEFAULT 0,
    output_tokens         INT          NOT NULL DEFAULT 0,
    cache_creation_tokens INT          NOT NULL DEFAULT 0,
    cache_read_tokens     INT          NOT NULL DEFAULT 0,
    cost_micros           BIGINT       NOT NULL DEFAULT 0,   -- micro-USD (10^-6 USD)
    created_at            BIGINT       NOT NULL,             -- ms epoch
    INDEX idx_usage_created (created_at),
    INDEX idx_usage_route   (route)
  ) ENGINE=InnoDB`,

  // Trend-sensing time series (NEXT-LEVEL-PLAN P1). Deterministic per-day
  // counts of terms extracted from public-source items (news/OSINT/crisis) —
  // never email content. signal_seen is the dedup ledger so 90 s polling never
  // double-counts an item; it is load-bearing, not an optimization.
  `CREATE TABLE IF NOT EXISTS signal_daily_counts (
    date  VARCHAR(10)  NOT NULL,
    kind  VARCHAR(16)  NOT NULL,
    term  VARCHAR(120) NOT NULL,
    count INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (date, kind, term),
    INDEX idx_sdc_term (kind, term, date)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS signal_seen (
    id   VARCHAR(40) NOT NULL PRIMARY KEY,
    date VARCHAR(10) NOT NULL,
    INDEX idx_seen_date (date)
  ) ENGINE=InnoDB`,

  // TDY / travel trips. The active trip (today within [start,end]) becomes the
  // user's "effective location", overriding home for weather + local news +
  // the morning brief, then auto-reverts when the trip ends.
  `CREATE TABLE IF NOT EXISTS trips (
    id          VARCHAR(36)  NOT NULL PRIMARY KEY,
    label       VARCHAR(120) NOT NULL,
    location    VARCHAR(200) NOT NULL,
    lat         DOUBLE       NOT NULL,
    lon         DOUBLE       NOT NULL,
    start_date  VARCHAR(10)  NOT NULL,
    end_date    VARCHAR(10)  NOT NULL,
    tz          VARCHAR(64)  NULL,
    feed_key    VARCHAR(64)  NULL,
    notes       TEXT         NULL,
    source      VARCHAR(16)  NOT NULL DEFAULT 'manual',
    event_id    VARCHAR(255) NULL,
    created_at  DATETIME(3)  NOT NULL,
    INDEX idx_trips_dates (start_date, end_date)
  ) ENGINE=InnoDB`,

  // Keep-in-touch / relationship cadence. A roster of important people, each
  // with a check-in cadence; "last_contacted" is set manually (mark-contacted),
  // and the app surfaces who's due/overdue on the Calendar tab.
  `CREATE TABLE IF NOT EXISTS contacts (
    id             VARCHAR(36)  NOT NULL PRIMARY KEY,
    name           VARCHAR(160) NOT NULL,
    email          VARCHAR(254) NULL,
    cadence_days   INT          NOT NULL DEFAULT 90,
    tier           VARCHAR(24)  NULL,
    last_contacted VARCHAR(10)  NULL,
    notes          TEXT         NULL,
    created_at     DATETIME(3)  NOT NULL,
    INDEX idx_contacts_name (name)
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
  { table: "user_prefs",  column: "tracked_locations",         ddl: "ALTER TABLE user_prefs ADD COLUMN tracked_locations          JSON NULL" },
  { table: "user_prefs",  column: "markets_watchlist",         ddl: "ALTER TABLE user_prefs ADD COLUMN markets_watchlist          JSON NULL" },
  { table: "user_prefs",  column: "osint_feeds",               ddl: "ALTER TABLE user_prefs ADD COLUMN osint_feeds                JSON NULL" },
  { table: "user_memory", column: "pending_exchanges",         ddl: "ALTER TABLE user_memory ADD COLUMN pending_exchanges JSON NULL" },
  { table: "briefing_cache", column: "tz",                     ddl: "ALTER TABLE briefing_cache ADD COLUMN tz VARCHAR(64) NOT NULL DEFAULT 'UTC'" },
  { table: "news_overview_cache", column: "ctx_hash",          ddl: "ALTER TABLE news_overview_cache ADD COLUMN ctx_hash VARCHAR(16) NOT NULL DEFAULT ''" },
  { table: "user_prefs",  column: "ai_enabled",                ddl: "ALTER TABLE user_prefs ADD COLUMN ai_enabled TINYINT(1) NOT NULL DEFAULT 1" },
  { table: "user_prefs",  column: "ai_feature_toggles",        ddl: "ALTER TABLE user_prefs ADD COLUMN ai_feature_toggles JSON NULL" },
  { table: "user_prefs",  column: "disabled_news_sources",     ddl: "ALTER TABLE user_prefs ADD COLUMN disabled_news_sources JSON NULL" },
  { table: "user_prefs",  column: "newsletter_sources",        ddl: "ALTER TABLE user_prefs ADD COLUMN newsletter_sources JSON NULL" },
  { table: "user_prefs",  column: "metar_stations",            ddl: "ALTER TABLE user_prefs ADD COLUMN metar_stations JSON NULL" },
  { table: "user_prefs",  column: "force_locations",           ddl: "ALTER TABLE user_prefs ADD COLUMN force_locations JSON NULL" },
  { table: "user_prefs",  column: "countries_of_interest",     ddl: "ALTER TABLE user_prefs ADD COLUMN countries_of_interest JSON NULL" },
  { table: "documents",   column: "archived",                  ddl: "ALTER TABLE documents ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0" },
  { table: "user_prefs",  column: "acled_email",               ddl: "ALTER TABLE user_prefs ADD COLUMN acled_email    VARCHAR(255) NULL" },
  { table: "user_prefs",  column: "acled_password",            ddl: "ALTER TABLE user_prefs ADD COLUMN acled_password TEXT NULL" },
  { table: "user_prefs",  column: "sitrep_bases",              ddl: "ALTER TABLE user_prefs ADD COLUMN sitrep_bases JSON NULL" },
  { table: "user_prefs",  column: "timezone_mode",             ddl: "ALTER TABLE user_prefs ADD COLUMN timezone_mode VARCHAR(16) NOT NULL DEFAULT 'auto'" },
  { table: "documents",       column: "aliases",  ddl: "ALTER TABLE documents ADD COLUMN aliases JSON NULL" },
  { table: "documents",       column: "collection", ddl: "ALTER TABLE documents ADD COLUMN collection VARCHAR(64) NULL" },
  { table: "documents",       column: "doc_type",   ddl: "ALTER TABLE documents ADD COLUMN doc_type VARCHAR(16) NOT NULL DEFAULT 'note'" },
  { table: "documents",       column: "props",      ddl: "ALTER TABLE documents ADD COLUMN props JSON NULL" },
  { table: "document_links",  column: "relation", ddl: "ALTER TABLE document_links ADD COLUMN relation VARCHAR(16) NULL" },
  { table: "document_links",  column: "note",     ddl: "ALTER TABLE document_links ADD COLUMN note VARCHAR(500) NULL" },
  // P7 instrumentation: wall-time of the model call and (where measurable) the
  // upstream assembly phase, so latency claims cite measured baselines.
  { table: "anthropic_usage", column: "duration_ms",           ddl: "ALTER TABLE anthropic_usage ADD COLUMN duration_ms INT NULL" },
  { table: "anthropic_usage", column: "assembly_ms",           ddl: "ALTER TABLE anthropic_usage ADD COLUMN assembly_ms INT NULL" },
  // Cross-device sync of the newsletter hide/keep sets (previously localStorage
  // only, so a newsletter dismissed on desktop reappeared on mobile).
  { table: "newsletter_prefs", column: "dismissed",            ddl: "ALTER TABLE newsletter_prefs ADD COLUMN dismissed JSON NULL" },
  { table: "newsletter_prefs", column: "kept",                 ddl: "ALTER TABLE newsletter_prefs ADD COLUMN kept      JSON NULL" },
  // Calendar-derived TDY trips: `source` distinguishes auto-synced ('calendar')
  // from hand-entered ('manual') trips so a re-sync never clobbers manual ones;
  // `event_id` keys a calendar trip to its source event for idempotent upsert.
  { table: "trips", column: "source",   ddl: "ALTER TABLE trips ADD COLUMN source   VARCHAR(16)  NOT NULL DEFAULT 'manual'" },
  { table: "trips", column: "event_id", ddl: "ALTER TABLE trips ADD COLUMN event_id VARCHAR(255) NULL" },
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
