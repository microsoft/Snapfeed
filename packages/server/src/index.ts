/**
 * @microsoft/snapfeed-server
 *
 * Public API:
 *  - snapfeedRoutes(db)       — mount into your own Hono app
 *  - createSnapfeedServer()   — standalone server with defaults
 *  - openDb()                 — create/open a SQLite database
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openDb } from './db.js'
import { snapfeedRoutes } from './routes.js'

export type { DatabaseType, OpenDbOptions } from './db.js'
export { openDb } from './db.js'
export { snapfeedRoutes } from './routes.js'
export type { SessionSummary, StoredEvent, TelemetryBatch, TelemetryEvent } from './types.js'

export interface ServerOptions {
  /** Port to listen on. Default: 8420 */
  port?: number
  /** SQLite database path. Default: './snapfeed.db' */
  dbPath?: string
  /** Enable CORS for all origins. Default: true */
  corsEnabled?: boolean
  /** Additional Hono middleware or routes to mount. */
  configure?: (app: Hono) => void
}

export function createSnapfeedServer(options: ServerOptions = {}): {
  app: Hono
  db: ReturnType<typeof openDb>
  server: ReturnType<typeof serve>
} {
  const port = options.port ?? 8420
  const dbPath = options.dbPath ?? './snapfeed.db'

  const db = openDb({ path: dbPath })
  const app = new Hono()

  if (options.corsEnabled !== false) {
    app.use('*', cors())
  }

  if (options.configure) {
    options.configure(app)
  }

  app.route('/', snapfeedRoutes(db))

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', db: dbPath }))

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`🔭 snapfeed-server listening on http://localhost:${info.port}`)
    console.log(`   db: ${dbPath}`)
  })

  return { app, db, server }
}
