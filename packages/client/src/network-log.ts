/**
 * Network request log — maintains a rolling buffer of recent fetch() calls.
 *
 * Captures both successful and failed requests with timing information.
 * The buffer is attached to feedback events to give agents full network context.
 */

const MAX_URL_LENGTH = 200
const DEFAULT_MAX_SIZE = 30

export interface NetworkLogEntry {
  url: string
  method: string
  status: number | null // null for network errors
  durationMs: number
  ts: string // ISO timestamp
  ok: boolean
}

export interface NetworkLogConfig {
  maxSize?: number // default 30
  /** URL patterns to exclude from logging (e.g., telemetry endpoint) */
  excludePatterns?: string[]
}

export interface NetworkLog {
  wrapFetch(originalFetch: typeof fetch): typeof fetch
  getEntries(): NetworkLogEntry[]
  clear(): void
  destroy(): void
}

function truncateUrl(url: string): string {
  return url.length > MAX_URL_LENGTH ? url.slice(0, MAX_URL_LENGTH) : url
}

export function createNetworkLog(config?: NetworkLogConfig): NetworkLog {
  const maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE
  const excludePatterns = config?.excludePatterns ?? []

  let buffer: NetworkLogEntry[] = []
  let head = 0
  let count = 0

  function push(entry: NetworkLogEntry): void {
    if (count < maxSize) {
      buffer.push(entry)
      count++
    } else {
      buffer[head] = entry
      head = (head + 1) % maxSize
    }
  }

  function isExcluded(url: string): boolean {
    return excludePatterns.some((p) => url.includes(p))
  }

  return {
    wrapFetch(originalFetch: typeof fetch): typeof fetch {
      return async function wrappedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url

        if (isExcluded(url)) {
          return originalFetch(input, init)
        }

        const method = (init?.method ?? 'GET').toUpperCase()
        const start = Date.now()

        try {
          const res = await originalFetch(input, init)
          push({
            url: truncateUrl(url),
            method,
            status: res.status,
            durationMs: Date.now() - start,
            ts: new Date().toISOString(),
            ok: res.ok,
          })
          return res
        } catch (err) {
          push({
            url: truncateUrl(url),
            method,
            status: null,
            durationMs: Date.now() - start,
            ts: new Date().toISOString(),
            ok: false,
          })
          throw err
        }
      }
    },

    getEntries(): NetworkLogEntry[] {
      if (count < maxSize) {
        return buffer.slice()
      }
      return [...buffer.slice(head), ...buffer.slice(0, head)]
    },

    clear(): void {
      buffer = []
      head = 0
      count = 0
    },

    destroy(): void {
      buffer = []
      head = 0
      count = 0
    },
  }
}
