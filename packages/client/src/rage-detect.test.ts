import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RageClickInfo } from './rage-detect.js'
import { createRageDetector } from './rage-detect.js'

describe('rage-detect', () => {
  let onRageClick: ReturnType<typeof vi.fn<(info: RageClickInfo) => void>>

  beforeEach(() => {
    onRageClick = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('triggers callback after 3 rapid clicks on the same target', () => {
    const detector = createRageDetector({ onRageClick })

    detector.recordClick('#btn', 10, 20)
    detector.recordClick('#btn', 10, 20)
    detector.recordClick('#btn', 12, 22)

    expect(onRageClick).toHaveBeenCalledOnce()
    expect(onRageClick).toHaveBeenCalledWith(
      expect.objectContaining({
        target: '#btn',
        clickCount: 3,
        x: 12,
        y: 22,
      }),
    )
  })

  it('does NOT trigger for only 2 clicks (below default threshold)', () => {
    const detector = createRageDetector({ onRageClick })

    detector.recordClick('#btn', 10, 20)
    detector.recordClick('#btn', 10, 20)

    expect(onRageClick).not.toHaveBeenCalled()
  })

  it('does NOT trigger for 3 clicks on DIFFERENT targets', () => {
    const detector = createRageDetector({ onRageClick })

    detector.recordClick('#a', 10, 20)
    detector.recordClick('#b', 10, 20)
    detector.recordClick('#c', 10, 20)

    expect(onRageClick).not.toHaveBeenCalled()
  })

  it('does NOT trigger when clicks are spread beyond windowMs', () => {
    const detector = createRageDetector({ onRageClick, windowMs: 500 })

    detector.recordClick('#btn', 10, 20)
    vi.advanceTimersByTime(300)
    detector.recordClick('#btn', 10, 20)
    vi.advanceTimersByTime(300)
    detector.recordClick('#btn', 10, 20)

    expect(onRageClick).not.toHaveBeenCalled()
  })

  it('respects a custom threshold of 5', () => {
    const detector = createRageDetector({ onRageClick, threshold: 5 })

    for (let i = 0; i < 4; i++) detector.recordClick('#btn', 10, 20)
    expect(onRageClick).not.toHaveBeenCalled()

    detector.recordClick('#btn', 10, 20)
    expect(onRageClick).toHaveBeenCalledOnce()
    expect(onRageClick).toHaveBeenCalledWith(expect.objectContaining({ clickCount: 5 }))
  })

  it('cleans up old entries outside the window', () => {
    const detector = createRageDetector({ onRageClick, windowMs: 500 })

    // Two clicks, then wait beyond the window
    detector.recordClick('#btn', 10, 20)
    detector.recordClick('#btn', 10, 20)
    vi.advanceTimersByTime(600)

    // Third click is outside the window of the first two — should NOT trigger
    detector.recordClick('#btn', 10, 20)

    expect(onRageClick).not.toHaveBeenCalled()
  })

  it('destroy() prevents further detection', () => {
    const detector = createRageDetector({ onRageClick })

    detector.recordClick('#btn', 10, 20)
    detector.destroy()
    detector.recordClick('#btn', 10, 20)
    detector.recordClick('#btn', 10, 20)

    expect(onRageClick).not.toHaveBeenCalled()
  })
})
