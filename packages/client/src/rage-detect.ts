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
    const currentClick = { target, x, y, ts: now }
    let nextLength = 0
    let matchingCount = 1
    let firstMatch = currentClick

    for (let index = 0; index < buffer.length; index++) {
      const entry = buffer[index]
      if (now - entry.ts > windowMs) continue

      buffer[nextLength] = entry
      nextLength++

      if (entry.target !== target) continue

      matchingCount++
      if (entry.ts < firstMatch.ts) firstMatch = entry
    }

    buffer.length = nextLength
    buffer.push(currentClick)

    // Keep buffer bounded
    if (buffer.length > MAX_BUFFER) {
      buffer.splice(0, buffer.length - MAX_BUFFER)
    }

    if (matchingCount >= threshold) {
      config.onRageClick({
        target,
        clickCount: matchingCount,
        durationMs: currentClick.ts - firstMatch.ts,
        x,
        y,
      })

      // Clear matched entries so we don't fire again for the same burst
      let retainedLength = 0
      for (let index = 0; index < buffer.length; index++) {
        const entry = buffer[index]
        if (entry.target === target) continue
        buffer[retainedLength] = entry
        retainedLength++
      }
      buffer.length = retainedLength
    }
  }

  function destroy(): void {
    destroyed = true
    buffer = []
  }

  return { recordClick, destroy }
}
