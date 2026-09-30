/**
 * Schema migrations, applied in order at boot. Never edit one that has
 * shipped — add a new entry (AGENTS.md rule 7).
 */
export const MIGRATIONS: readonly { id: string; sql: string }[] = [
	{
		id: "0001_company_graph",
		sql: `
      CREATE TABLE company (
        singleton   INTEGER PRIMARY KEY CHECK (singleton = 1),
        id          TEXT NOT NULL,
        name        TEXT NOT NULL,
        summary     TEXT NOT NULL DEFAULT '',
        timezone    TEXT NOT NULL DEFAULT 'UTC',
        founder_key TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE org_nodes (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        id         TEXT NOT NULL UNIQUE,
        key        TEXT NOT NULL UNIQUE,
        kind       TEXT NOT NULL CHECK (kind IN ('dream','team','human','agent','responsibility','tool','heartbeat')),
        name       TEXT NOT NULL,
        ref_id     TEXT,
        config     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config)),
        pos_x      REAL NOT NULL DEFAULT 0,
        pos_y      REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE org_edges (
        seq          INTEGER PRIMARY KEY AUTOINCREMENT,
        id           TEXT NOT NULL UNIQUE,
        from_node_id TEXT NOT NULL REFERENCES org_nodes(id),
        to_node_id   TEXT NOT NULL REFERENCES org_nodes(id),
        relation     TEXT NOT NULL CHECK (relation IN ('requires','owns','member_of','responsible_for','uses','has_access_to','monitors','invokes','depends_on')),
        valid_from   TEXT NOT NULL,
        valid_to     TEXT
      );
      CREATE INDEX org_edges_from ON org_edges (from_node_id);
      CREATE INDEX org_edges_to ON org_edges (to_node_id);
    `,
	},
	{
		id: "0002_people_conversations_memory_events_jobs_ledger",
		sql: `
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL CHECK (json_valid(value)),
        updated_at TEXT NOT NULL
      );

      CREATE TABLE people (
        seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
        id                  TEXT NOT NULL UNIQUE,
        display_name        TEXT NOT NULL,
        email               TEXT,
        phone               TEXT,
        consent             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(consent)),
        profile             TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(profile)),
        context_summary     TEXT,
        last_interaction_at TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX people_email ON people (email);
      CREATE INDEX people_phone ON people (phone);

      CREATE TABLE identities (
        id         TEXT PRIMARY KEY,
        person_id  TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        provider   TEXT NOT NULL,
        value      TEXT NOT NULL,
        verified   INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 1,
        source     TEXT NOT NULL DEFAULT 'observed' CHECK (source IN ('observed','stated','imported')),
        created_at TEXT NOT NULL,
        UNIQUE (provider, value)
      );
      CREATE INDEX identities_person ON identities (person_id);

      CREATE TABLE conversations (
        seq                INTEGER PRIMARY KEY AUTOINCREMENT,
        id                 TEXT NOT NULL UNIQUE,
        channel            TEXT NOT NULL CHECK (channel IN ('telegram')),
        external_thread_id TEXT NOT NULL,
        person_id          TEXT REFERENCES people(id) ON DELETE SET NULL,
        title              TEXT,
        created_at         TEXT NOT NULL,
        last_message_at    TEXT,
        UNIQUE (channel, external_thread_id)
      );
      CREATE INDEX conversations_person ON conversations (person_id);

      CREATE TABLE messages (
        seq             INTEGER PRIMARY KEY AUTOINCREMENT,
        id              TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        direction       TEXT NOT NULL CHECK (direction IN ('in','out')),
        status          TEXT NOT NULL CHECK (status IN ('received','pending','sent','failed')),
        text            TEXT NOT NULL,
        person_id       TEXT REFERENCES people(id) ON DELETE SET NULL,
        agent_key       TEXT,
        external_id     TEXT,
        error           TEXT,
        created_at      TEXT NOT NULL,
        sent_at         TEXT
      );
      CREATE INDEX messages_conversation ON messages (conversation_id, seq);
      CREATE INDEX messages_pending ON messages (seq) WHERE status = 'pending';
      CREATE UNIQUE INDEX messages_inbound_once ON messages (conversation_id, external_id)
        WHERE direction = 'in' AND external_id IS NOT NULL;

      CREATE TABLE memories (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        id         TEXT NOT NULL UNIQUE,
        scope      TEXT NOT NULL CHECK (scope IN ('person','company','agent')),
        owner_id   TEXT,
        kind       TEXT NOT NULL,
        content    TEXT NOT NULL,
        data       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
        source     TEXT NOT NULL CHECK (source IN ('conversation','agent','human','system','import')),
        confidence REAL NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX memories_owner ON memories (scope, owner_id, seq);
      CREATE VIRTUAL TABLE memories_fts USING fts5 (
        content, kind, content = 'memories', content_rowid = 'seq',
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts (rowid, content, kind) VALUES (new.seq, new.content, new.kind);
      END;
      CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts (memories_fts, rowid, content, kind) VALUES ('delete', old.seq, old.content, old.kind);
      END;
      CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts (memories_fts, rowid, content, kind) VALUES ('delete', old.seq, old.content, old.kind);
        INSERT INTO memories_fts (rowid, content, kind) VALUES (new.seq, new.content, new.kind);
      END;

      CREATE TABLE events (
        seq             INTEGER PRIMARY KEY AUTOINCREMENT,
        id              TEXT NOT NULL UNIQUE,
        type            TEXT NOT NULL,
        source          TEXT NOT NULL,
        subject         TEXT,
        time            TEXT NOT NULL,
        data            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
        idempotency_key TEXT NOT NULL UNIQUE,
        delivered_at    TEXT
      );
      CREATE INDEX events_undelivered ON events (seq) WHERE delivered_at IS NULL;

      CREATE TABLE jobs (
        seq          INTEGER PRIMARY KEY AUTOINCREMENT,
        id           TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,
        key          TEXT UNIQUE,
        payload      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
        status       TEXT NOT NULL CHECK (status IN ('queued','running','done','dead')),
        run_at       TEXT NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
        last_error   TEXT,
        locked_until TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX jobs_due ON jobs (status, run_at);

      CREATE TABLE ledger_entries (
        seq          INTEGER PRIMARY KEY AUTOINCREMENT,
        id           TEXT NOT NULL UNIQUE,
        currency     TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
        amount_minor INTEGER NOT NULL,
        description  TEXT NOT NULL,
        ref          TEXT,
        occurred_at  TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX ledger_currency ON ledger_entries (currency, seq);
    `,
	},
	{
		id: "0003_brain_runs_transcripts_approvals",
		sql: `
      CREATE TABLE runs (
        seq                INTEGER PRIMARY KEY AUTOINCREMENT,
        id                 TEXT NOT NULL UNIQUE,
        session_id         TEXT NOT NULL,
        agent_key          TEXT NOT NULL,
        status             TEXT NOT NULL CHECK (status IN ('running','done','awaiting_approval','error','aborted')),
        model              TEXT,
        trigger            TEXT NOT NULL,
        input              TEXT,
        output             TEXT,
        error              TEXT,
        input_tokens       INTEGER NOT NULL DEFAULT 0,
        output_tokens      INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        cost_micro_usd     INTEGER NOT NULL DEFAULT 0,
        started_at         TEXT NOT NULL,
        ended_at           TEXT
      );
      CREATE INDEX runs_session ON runs (session_id, seq);
      CREATE INDEX runs_agent ON runs (agent_key, seq);
      CREATE INDEX runs_started ON runs (started_at);

      CREATE TABLE transcript_messages (
        session_id TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        message    TEXT NOT NULL CHECK (json_valid(message)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );

      CREATE TABLE approvals (
        seq          INTEGER PRIMARY KEY AUTOINCREMENT,
        id           TEXT NOT NULL UNIQUE,
        run_id       TEXT NOT NULL REFERENCES runs(id),
        session_id   TEXT NOT NULL,
        agent_key    TEXT NOT NULL,
        tool         TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        args         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(args)),
        status       TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
        decided_by   TEXT,
        note         TEXT,
        created_at   TEXT NOT NULL,
        decided_at   TEXT
      );
      CREATE INDEX approvals_pending ON approvals (seq) WHERE status = 'pending';
    `,
	},
	{
		id: "0004_secrets",
		sql: `
      CREATE TABLE secrets (
        ref        TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
	},
];
