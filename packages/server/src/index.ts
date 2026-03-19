/**
 * @microsoft/snapfeed-server
 *
 * Public API:
 *  - snapfeedRoutes(db)       — mount into your own Hono app
 *  - createSnapfeedServer()   — standalone server with defaults
 *  - openDb()                 — create/open a SQLite database
 *  - rateLimit()              — rate limiting middleware
 *  - originAllowlist()        — origin restriction middleware
 *  - payloadLimits()          — payload size validation middleware
 */

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { openDb } from './db.js'
import { snapfeedRoutes } from './routes.js'
import { rateLimit } from './security.js'

export type { DatabaseType, OpenDbOptions } from './db.js'
export { openDb } from './db.js'
export { snapfeedRoutes } from './routes.js'
export {
  type OriginAllowlistOptions,
  originAllowlist,
  type PayloadLimitOptions,
  payloadLimits,
  type RateLimitOptions,
  rateLimit,
} from './security.js'
export type { SessionSummary, StoredEvent, TelemetryBatch, TelemetryEvent } from './types.js'

export interface ServerOptions {
  /** Port to listen on. Default: 8420 */
  port?: number
  /** SQLite database path. Default: './snapfeed.db' */
  dbPath?: string
  /** Enable CORS for all origins. Default: true */
  corsEnabled?: boolean
  /** Enable rate limiting. Default: true (60 req/min) */
  rateLimitEnabled?: boolean
  /** Rate limit: max requests per window. Default: 60 */
  rateLimitMax?: number
  /** Allowed origins. Null = allow all. */
  allowedOrigins?: (string | RegExp)[] | null
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

  if (options.rateLimitEnabled !== false) {
    app.use('/api/*', rateLimit({ max: options.rateLimitMax ?? 60 }))
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
