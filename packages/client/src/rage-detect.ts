/**
 * Rage click detection — detects rapid repeated clicks on the same element.
 *
 * When a user clicks the same target N+ times within a time window,
 * a 'rage_click' event is emitted with the click count and duration.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RageClickInfo {
  target: string
  clickCount: number
  durationMs: number
  x: number
  y: number
}

export interface RageDetectConfig {
  threshold?: number
  windowMs?: number
  onRageClick: (info: RageClickInfo) => void
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ClickEntry {
  target: string
  x: number
  y: number
  ts: number
}

const MAX_BUFFER = 20
const DEFAULT_THRESHOLD = 3
const DEFAULT_WINDOW_MS = 1000

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRageDetector(config: RageDetectConfig) {
  const threshold = config.threshold ?? DEFAULT_THRESHOLD
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS

  let buffer: ClickEntry[] = []
  let destroyed = false

  function recordClick(target: string, x: number, y: number): void {
    if (destroyed) return

    const now = Date.now()

    // Remove entries older than the window
    buffer = buffer.filter((e) => now - e.ts <= windowMs)

    buffer.push({ target, x, y, ts: now })

    // Keep buffer bounded
    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(buffer.length - MAX_BUFFER)
    }

    // Count matching clicks within the window
    const matching = buffer.filter((e) => e.target === target)
    if (matching.length >= threshold) {
      const first = matching[0]
      const last = matching[matching.length - 1]
      config.onRageClick({
        target,
        clickCount: matching.length,
        durationMs: last.ts - first.ts,
        x,
        y,
      })

      // Clear matched entries so we don't fire again for the same burst
      buffer = buffer.filter((e) => e.target !== target)
    }
  }

  function destroy(): void {
    destroyed = true
    buffer = []
  }

  return { recordClick, destroy }
}
