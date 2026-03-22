// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionReplay,
  cssPath,
  type MutationData,
  type ReplayEvent,
  type SessionReplay,
} from './session-replay.js'

// ---------------------------------------------------------------------------
// cssPath helper
// ---------------------------------------------------------------------------

describe('cssPath', () => {
  it('returns tag#id.class for a fully-described element', () => {
    const el = document.createElement('div')
    el.id = 'hero'
    el.classList.add('banner')
    expect(cssPath(el)).toBe('div#hero.banner')
  })

  it('returns tag.class when there is no id', () => {
    const el = document.createElement('span')
    el.classList.add('highlight')
    expect(cssPath(el)).toBe('span.highlight')
  })

  it('returns tag#id when there are no classes', () => {
    const el = document.createElement('p')
    el.id = 'intro'
    expect(cssPath(el)).toBe('p#intro')
  })

  it('returns just tag for a bare element', () => {
    expect(cssPath(document.createElement('section'))).toBe('section')
  })

  it('truncates to 100 chars', () => {
    const el = document.createElement('div')
    el.id = 'a'.repeat(120)
    expect(cssPath(el).length).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// createSessionReplay — buffer basics
// ---------------------------------------------------------------------------

describe('createSessionReplay', () => {
  let replay: SessionReplay

  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    replay = createSessionReplay({ windowSec: 60, maxEvents: 50 })
  })

  afterEach(() => {
    replay.stop()
  })

  it('getEvents() returns empty array initially', () => {
    expect(replay.getEvents()).toEqual([])
  })

  it('clear() empties the buffer', () => {
    replay.start()
    document.body.innerHTML = '<p>hi</p>'
    // wait for MutationObserver
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(replay.getEvents().length).toBeGreaterThan(0)
        replay.clear()
        expect(replay.getEvents()).toEqual([])
        resolve()
      }, 50)
    })
  })

  // -----------------------------------------------------------------------
  // MutationObserver
  // -----------------------------------------------------------------------

  describe('mutation recording', () => {
    it('records childList mutations', async () => {
      replay.start()
      const el = document.createElement('div')
      el.id = 'added'
      document.body.appendChild(el)

      await new Promise((r) => setTimeout(r, 50))
      const events = replay.getEvents()
      expect(events.length).toBeGreaterThan(0)
      expect(events[0].type).toBe('mutation')

      const data = events[0].data as MutationData[]
      expect(data.some((d) => d.kind === 'childList' && d.summary.includes('added'))).toBe(true)
    })

    it('records attribute mutations', async () => {
      document.body.innerHTML = '<div id="target"></div>'
      replay.start()

      document.getElementById('target')!.setAttribute('data-x', '1')
      await new Promise((r) => setTimeout(r, 50))

      const events = replay.getEvents()
      const mutationEvents = events.filter((e) => e.type === 'mutation')
      expect(mutationEvents.length).toBeGreaterThan(0)

      const data = mutationEvents.flatMap((e) => e.data as MutationData[])
      expect(data.some((d) => d.kind === 'attributes' && d.summary.includes('data-x'))).toBe(true)
    })

    it('records characterData mutations', async () => {
      document.body.innerHTML = '<p id="txt">old</p>'
      replay.start()

      const textNode = document.getElementById('txt')!.firstChild!
      textNode.textContent = 'new'
      await new Promise((r) => setTimeout(r, 50))

      const events = replay.getEvents()
      const data = events
        .filter((e) => e.type === 'mutation')
        .flatMap((e) => e.data as MutationData[])
      expect(data.some((d) => d.kind === 'characterData' && d.summary === 'text changed')).toBe(
        true,
      )
    })
  })

  // -----------------------------------------------------------------------
  // stop() prevents further recording
  // -----------------------------------------------------------------------

  describe('stop()', () => {
    it('prevents mutations from being recorded after stop', async () => {
      replay.start()
      replay.stop()

      document.body.innerHTML = '<div>after stop</div>'
      await new Promise((r) => setTimeout(r, 50))

      expect(replay.getEvents()).toEqual([])
    })

    it('prevents scroll events from being recorded after stop', () => {
      replay.start()
      replay.stop()

      window.dispatchEvent(new Event('scroll'))
      expect(replay.getEvents()).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // Time-window pruning
  // -----------------------------------------------------------------------

  describe('time-window pruning', () => {
    it('removes events older than windowSec', () => {
      const short = createSessionReplay({ windowSec: 1, maxEvents: 100 })
      short.start()

      // Manually synthesise an old event via scroll, then fast-forward time
      window.dispatchEvent(new Event('scroll'))
      const events = short.getEvents()

      // Now fake time forward by 2 seconds
      const spy = vi.spyOn(Date, 'now')
      const future = Date.now() + 2000
      spy.mockReturnValue(future)

      // Trigger another scroll to cause pruning
      window.dispatchEvent(new Event('scroll'))

      const after = short.getEvents()
      // The old event should be pruned; only the new one (or none from throttle) remains
      for (const e of after) {
        expect(e.ts).toBeGreaterThanOrEqual(future - 1000)
      }

      short.stop()
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // Max events cap
  // -----------------------------------------------------------------------

  describe('maxEvents cap', () => {
    it('caps the buffer at maxEvents', () => {
      const tiny = createSessionReplay({ windowSec: 600, maxEvents: 5 })
      tiny.start()

      // Fire many scroll events; disable throttle by advancing Date.now each time
      let now = Date.now()
      const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
        now += 300 // exceed default scroll throttle
        return now
      })

      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new Event('scroll'))
      }

      expect(tiny.getEvents().length).toBeLessThanOrEqual(5)

      tiny.stop()
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // Throttling
  // -----------------------------------------------------------------------

  describe('throttling', () => {
    it('deduplicates rapid scroll events within the throttle window', () => {
      const r = createSessionReplay({ windowSec: 60, scrollThrottleMs: 200, maxEvents: 500 })
      r.start()

      // Fire many scroll events at the "same" timestamp
      const fixed = Date.now()
      const spy = vi.spyOn(Date, 'now').mockReturnValue(fixed)

      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event('scroll'))
      }

      const scrollEvents = r.getEvents().filter((e) => e.type === 'scroll')
      // Only the first event should pass the throttle
      expect(scrollEvents.length).toBe(1)

      r.stop()
      spy.mockRestore()
    })

    it('deduplicates rapid mousemove events within the throttle window', () => {
      const r = createSessionReplay({ windowSec: 60, mouseMoveThrottleMs: 100, maxEvents: 500 })
      r.start()

      const fixed = Date.now()
      const spy = vi.spyOn(Date, 'now').mockReturnValue(fixed)

      for (let i = 0; i < 10; i++) {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: i, clientY: i }))
      }

      const moveEvents = r.getEvents().filter((e) => e.type === 'mousemove')
      expect(moveEvents.length).toBe(1)

      r.stop()
      spy.mockRestore()
    })

    it('allows events after throttle window expires', () => {
      const r = createSessionReplay({ windowSec: 60, scrollThrottleMs: 200, maxEvents: 500 })
      r.start()

      let now = Date.now()
      const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)

      window.dispatchEvent(new Event('scroll'))

      // Advance past throttle window
      now += 300
      window.dispatchEvent(new Event('scroll'))

      const scrollEvents = r.getEvents().filter((e) => e.type === 'scroll')
      expect(scrollEvents.length).toBe(2)

      r.stop()
      spy.mockRestore()
    })
  })

  // -----------------------------------------------------------------------
  // Resize recording
  // -----------------------------------------------------------------------

  describe('resize recording', () => {
    it('records resize events', () => {
      replay.start()
      window.dispatchEvent(new Event('resize'))
      const events = replay.getEvents().filter((e) => e.type === 'resize')
      expect(events.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // getEvents returns a copy
  // -----------------------------------------------------------------------

  it('getEvents() returns a copy, not the internal buffer', () => {
    replay.start()
    window.dispatchEvent(new Event('scroll'))
    const a = replay.getEvents()
    const b = replay.getEvents()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })

  // -----------------------------------------------------------------------
  // start() is idempotent
  // -----------------------------------------------------------------------

  it('calling start() twice does not duplicate listeners', () => {
    replay.start()
    replay.start() // should be a no-op

    window.dispatchEvent(new Event('scroll'))
    const scrollEvents = replay.getEvents().filter((e) => e.type === 'scroll')
    expect(scrollEvents.length).toBe(1)
  })
})
