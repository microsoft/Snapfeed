/**
 * Lightweight session replay — records DOM mutations, scroll, and mouse
 * movement in a rolling time-window buffer.
 *
 * On feedback submission, the replay buffer provides structured data
 * that agents can parse to understand what the user did before reporting.
 * This is NOT video — it's structured event data optimized for agent consumption.
 */

export type ReplayEventType = 'mutation' | 'scroll' | 'mousemove' | 'resize'

export interface ReplayEvent {
  type: ReplayEventType
  ts: number
  data: unknown
}

export interface MutationData {
  /** CSS selector path of the mutated element */
  target: string
  /** What changed: 'childList' | 'attributes' | 'characterData' */
  kind: string
  /** Summary of changes (e.g., added/removed node count, changed attribute name) */
  summary: string
}

export interface ScrollData {
  x: number
  y: number
}

export interface MouseMoveData {
  x: number
  y: number
}

export interface ResizeData {
  width: number
  height: number
}

export interface SessionReplayConfig {
  /** Time window in seconds to keep. Default: 180 (3 minutes) */
  windowSec?: number
  /** Throttle interval for mousemove in ms. Default: 100 */
  mouseMoveThrottleMs?: number
  /** Throttle interval for scroll in ms. Default: 200 */
  scrollThrottleMs?: number
  /** Max events in buffer. Default: 5000 */
  maxEvents?: number
}

export interface SessionReplay {
  start(): void
  stop(): void
  getEvents(): ReplayEvent[]
  clear(): void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a compact CSS-ish selector for an element: `tag#id.firstClass` (max 100 chars). */
export function cssPath(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const firstClass = el.classList?.[0] ? `.${el.classList[0]}` : ''
  return `${tag}${id}${firstClass}`.slice(0, 100)
}

function summariseMutations(records: MutationRecord[]): MutationData[] {
  const out: MutationData[] = []
  for (const r of records) {
    const target = r.target instanceof Element ? cssPath(r.target) : 'text'
    if (r.type === 'childList') {
      const added = r.addedNodes.length
      const removed = r.removedNodes.length
      const parts: string[] = []
      if (added) parts.push(`added ${added} node${added > 1 ? 's' : ''}`)
      if (removed) parts.push(`removed ${removed} node${removed > 1 ? 's' : ''}`)
      if (parts.length) out.push({ target, kind: 'childList', summary: parts.join(', ') })
    } else if (r.type === 'attributes') {
      out.push({ target, kind: 'attributes', summary: `attr ${r.attributeName ?? '?'} changed` })
    } else if (r.type === 'characterData') {
      out.push({ target, kind: 'characterData', summary: 'text changed' })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const DEFAULTS: Required<SessionReplayConfig> = {
  windowSec: 180,
  mouseMoveThrottleMs: 100,
  scrollThrottleMs: 200,
  maxEvents: 5000,
}

export function createSessionReplay(config?: SessionReplayConfig): SessionReplay {
  const cfg = { ...DEFAULTS, ...config }

  let buffer: ReplayEvent[] = []
  let observer: MutationObserver | null = null
  let running = false

  // Per-type throttle timestamps
  const lastTs: Record<string, number> = {}

  // Store bound handlers so we can remove them
  let onScroll: (() => void) | null = null
  let onMouseMove: ((e: MouseEvent) => void) | null = null
  let onResize: (() => void) | null = null

  // ------ internal helpers ------

  function pruneOld(now: number): void {
    const cutoff = now - cfg.windowSec * 1000
    // Find first index that is within the window
    let i = 0
    while (i < buffer.length && buffer[i].ts < cutoff) i++
    if (i > 0) buffer = buffer.slice(i)
  }

  function push(event: ReplayEvent): void {
    pruneOld(event.ts)
    buffer.push(event)
    if (buffer.length > cfg.maxEvents) {
      buffer = buffer.slice(buffer.length - cfg.maxEvents)
    }
  }

  function throttled(type: string, thresholdMs: number, now: number): boolean {
    const prev = lastTs[type] ?? 0
    if (now - prev < thresholdMs) return true
    lastTs[type] = now
    return false
  }

  // ------ public API ------

  function start(): void {
    if (running) return
    running = true

    // MutationObserver
    observer = new MutationObserver((records) => {
      if (!running) return
      const data = summariseMutations(records)
      if (data.length) {
        push({ type: 'mutation', ts: Date.now(), data })
      }
    })
    observer.observe(document.body, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    })

    // Scroll
    onScroll = () => {
      const now = Date.now()
      if (throttled('scroll', cfg.scrollThrottleMs, now)) return
      const data: ScrollData = { x: window.scrollX, y: window.scrollY }
      push({ type: 'scroll', ts: now, data })
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    // Mouse move
    onMouseMove = (e: MouseEvent) => {
      const now = Date.now()
      if (throttled('mousemove', cfg.mouseMoveThrottleMs, now)) return
      const data: MouseMoveData = { x: e.clientX, y: e.clientY }
      push({ type: 'mousemove', ts: now, data })
    }
    document.addEventListener('mousemove', onMouseMove, { passive: true })

    // Resize
    onResize = () => {
      const now = Date.now()
      if (throttled('resize', cfg.scrollThrottleMs, now)) return
      const data: ResizeData = { width: window.innerWidth, height: window.innerHeight }
      push({ type: 'resize', ts: now, data })
    }
    window.addEventListener('resize', onResize, { passive: true })
  }

  function stop(): void {
    if (!running) return
    running = false

    observer?.disconnect()
    observer = null

    if (onScroll) {
      window.removeEventListener('scroll', onScroll)
      onScroll = null
    }
    if (onMouseMove) {
      document.removeEventListener('mousemove', onMouseMove)
      onMouseMove = null
    }
    if (onResize) {
      window.removeEventListener('resize', onResize)
      onResize = null
    }
  }

  function getEvents(): ReplayEvent[] {
    pruneOld(Date.now())
    return buffer.slice()
  }

  function clear(): void {
    buffer = []
  }

  return { start, stop, getEvents, clear }
}
