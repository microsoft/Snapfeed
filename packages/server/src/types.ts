/**
 * @microsoft/snapfeed-server — Shared types
 *
 * These mirror the client-side TelemetryEvent shape. Defined here so the
 * server package works standalone without requiring the client package.
 */

export interface TelemetryEvent {
  session_id: string
  seq: number
  ts: string
  event_type: string
  page?: string | null
  target?: string | null
  detail?: Record<string, unknown> | null
  screenshot?: string | null
}

export interface TelemetryBatch {
  events: TelemetryEvent[]
}

export interface SessionSummary {
  session_id: string
  first_event: string
  last_event: string
  event_count: number
  error_count: number
}

export interface StoredEvent {
  id: number
  session_id: string
  seq: number
  ts: string
  event_type: string
  page: string | null
  target: string | null
  detail_json: string | null
}
