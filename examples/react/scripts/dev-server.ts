import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

const port = Number(process.env.SNAPFEED_API_PORT ?? 8420);
const dbPath = path.resolve(
  process.cwd(),
  process.env.SNAPFEED_E2E_DB_PATH ?? ".tmp/react-example/snapfeed.db",
);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ui_telemetry (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT    NOT NULL,
    seq           INTEGER NOT NULL,
    ts            TEXT    NOT NULL,
    event_type    TEXT    NOT NULL,
    page          TEXT,
    target        TEXT,
    detail_json   TEXT,
    created_at    TEXT    DEFAULT (datetime('now')),
    resolved_at   TEXT,
    resolved_note TEXT,
    commit_sha    TEXT,
    screenshot    TEXT
);
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_session ON ui_telemetry(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_ui_telemetry_type ON ui_telemetry(event_type);
`;

type TelemetryEvent = {
  session_id: string;
  seq: number;
  ts: string;
  event_type: string;
  page?: string | null;
  target?: string | null;
  detail?: Record<string, unknown> | null;
  screenshot?: string | null;
};

type ServerRuntime = {
  close: (callback: () => void) => void;
  db: { close: () => void };
};

type SyncDatabase = {
  exec: (sql: string) => void;
  close: () => void;
  prepare: (sql: string) => {
    all: (...params: Array<string | number>) => unknown[];
    get: (...params: Array<string | number>) => unknown;
    run: (...params: Array<string | number | null>) => unknown;
  };
};

function removeFileIfPresent(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

if (process.env.SNAPFEED_RESET_DB === "true") {
  removeFileIfPresent(dbPath);
  removeFileIfPresent(`${dbPath}-shm`);
  removeFileIfPresent(`${dbPath}-wal`);
}

async function startFallbackServer(): Promise<ServerRuntime> {
  const sqliteModule = await import("node:sqlite");
  const db = new sqliteModule.DatabaseSync(dbPath) as SyncDatabase;
  db.exec(SCHEMA);
  db.exec("PRAGMA journal_mode = WAL");

  const insertSql = db.prepare(`
    INSERT OR IGNORE INTO ui_telemetry
      (session_id, seq, ts, event_type, page, target, detail_json, screenshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const app = new Hono();
  app.use("*", cors());

  app.post("/api/telemetry/events", async (c) => {
    const body = await c.req.json<{ events?: TelemetryEvent[] }>();
    const events = body.events;

    if (!Array.isArray(events) || events.length === 0) {
      return c.json({ error: "events array required" }, 400);
    }

    db.exec("BEGIN");
    try {
      for (const event of events) {
        insertSql.run(
          event.session_id,
          event.seq,
          event.ts,
          event.event_type,
          event.page ?? null,
          event.target ?? null,
          event.detail ? JSON.stringify(event.detail) : null,
          event.screenshot ?? null,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return c.json({ accepted: events.length });
  });

  app.get("/api/telemetry/events", (c) => {
    const sessionId = c.req.query("session_id");
    const eventType = c.req.query("event_type");
    const limit = Math.min(Number(c.req.query("limit") ?? 200), 1000);

    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (sessionId) {
      clauses.push("session_id = ?");
      params.push(sessionId);
    }
    if (eventType) {
      clauses.push("event_type = ?");
      params.push(eventType);
    }

    params.push(limit);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare(
        `SELECT id, session_id, seq, ts, event_type, page, target, detail_json
         FROM ui_telemetry ${where}
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(...params);

    return c.json(rows);
  });

  app.get("/api/telemetry/sessions", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
    const rows = db
      .prepare(
        `
        SELECT session_id,
               MIN(ts) as first_event,
               MAX(ts) as last_event,
               COUNT(*) as event_count,
               SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as error_count
        FROM ui_telemetry
        GROUP BY session_id
        ORDER BY MAX(created_at) DESC
        LIMIT ?
      `,
      )
      .all(limit);

    return c.json(rows);
  });

  app.get("/api/telemetry/events/:id/screenshot", (c) => {
    const eventId = Number(c.req.param("id"));
    const row = db
      .prepare("SELECT screenshot FROM ui_telemetry WHERE id = ?")
      .get(eventId) as { screenshot: string | null } | undefined;

    if (!row?.screenshot) {
      return c.json({ error: "No screenshot for this event" }, 404);
    }

    return new Response(Buffer.from(row.screenshot, "base64"), {
      headers: { "Content-Type": "image/jpeg" },
    });
  });

  app.get("/api/mock/ok", (c) => c.json({ status: "ok" }));
  app.get("/api/mock/failure", (c) =>
    c.json({ status: "error", code: 503 }, 503),
  );
  app.get("/health", (c) =>
    c.json({ status: "ok", db: dbPath, mode: "node:sqlite fallback" }),
  );

  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(
      `snapfeed-react-e2e fallback server listening on http://127.0.0.1:${port}`,
    );
  });

  return { db, close: (callback) => server.close(callback) };
}

async function startServer(): Promise<ServerRuntime> {
  try {
    const serverModule = await import("../../../packages/server/src/index.ts");
    const { db, server } = serverModule.createSnapfeedServer({
      port,
      dbPath,
      configure(app) {
        app.get("/api/mock/ok", (c) => c.json({ status: "ok" }));
        app.get("/api/mock/failure", (c) =>
          c.json({ status: "error", code: 503 }, 503),
        );
      },
    });

    console.log(
      `snapfeed-react-example server listening on http://127.0.0.1:${port}`,
    );
    console.log(`snapfeed-react-example database path: ${dbPath}`);
    return { db, close: (callback) => server.close(callback) };
  } catch (error) {
    console.warn(
      "Falling back to node:sqlite test server because better-sqlite3 is unavailable.",
    );
    console.warn(error);
    console.log(`snapfeed-react-example database path: ${dbPath}`);
    return startFallbackServer();
  }
}

const runtime = await startServer();

function shutdown(signal: string): void {
  console.log(`Shutting down Snapfeed React E2E server on ${signal}`);
  runtime.close(() => {
    runtime.db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
