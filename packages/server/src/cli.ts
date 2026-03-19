#!/usr/bin/env node
/**
 * snapfeed-server CLI — standalone telemetry server
 *
 * Usage:
 *   npx snapfeed-server                      # defaults: port 8420, ./snapfeed.db
 *   npx snapfeed-server --port 3000          # custom port
 *   npx snapfeed-server --db /tmp/events.db  # custom db path
 */

import { createSnapfeedServer } from './index.js'

const args = process.argv.slice(2)

function flag(name: string, fallback: string): string {
  const idx = args.indexOf(name)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const port = Number(flag('--port', '8420'))
const dbPath = flag('--db', './snapfeed.db')

createSnapfeedServer({ port, dbPath })
