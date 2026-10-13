// @vitest-environment jsdom

import html2canvas from 'html2canvas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./annotation.js', () => ({
  showAnnotationCanvas: vi.fn().mockResolvedValue(null),
}))

vi.mock('./console-capture.js', () => ({
  getConsoleErrors: vi.fn(() => ['Error: boom']),
}))

vi.mock('./plugins.js', () => ({
  enrichElement: vi.fn(() => null),
}))

vi.mock('./sanitize.js', () => ({
  sanitizeDetail: vi.fn((detail: Record<string, unknown>) => detail),
}))

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 600
    return canvas
  }),
}))

import {
  createFeedbackController,
  dismissFeedbackDialog,
  getFeedbackTrigger,
  handleCtrlClick,
  initFeedback,
  showFeedbackDialog,
} from './feedback.js'
import { enrichElement } from './plugins.js'
import * as queue from './queue.js'
import { type FeedbackAdapter, resolveConfig } from './types.js'

function createCanvasContext(): CanvasRenderingContext2D {
  return {
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    strokeRect: vi.fn(),
    lineCap: 'round',
    lineJoin: 'round',
    strokeStyle: '#000000',
    lineWidth: 1,
    fillStyle: '#000000',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D
}

async function flushUi(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
  await Promise.resolve()
}

function mockOverlayRect(overlay: HTMLElement, width: number, height: number): void {
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function createTarget(): HTMLElement {
  const target = document.createElement('button')
  target.type = 'button'
  target.textContent = 'Revamp annotation toolbar'
  target.setAttribute('aria-label', 'Revamp annotation toolbar card')
  target.dataset.feedbackContext = 'search-results'
  target.dataset.index = '7'
  document.body.appendChild(target)
  return target
}

describe('feedback overlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(enrichElement).mockReset()
    vi.mocked(enrichElement).mockReturnValue(null)
    vi.mocked(html2canvas).mockReset()
    vi.mocked(html2canvas).mockImplementation(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 600
      return canvas
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createCanvasContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,ZmFrZS1pbWFnZQ==',
    )
    initFeedback(
      resolveConfig({
        endpoint: '/api/test-feedback',
        feedback: {
          enabled: true,
          annotations: true,
          allowScreenshotToggle: true,
          allowContextToggle: true,
        },
        captureConsoleErrors: true,
      }),
    )
  })

  afterEach(() => {
    dismissFeedbackDialog()
    document.body.innerHTML = ''
  })

  it('focuses the textarea and enables send when text is entered', async () => {
    const target = createTarget()

    showFeedbackDialog(target, 120, 80)
    await flushUi()

    const textarea = document.getElementById('__sf_text') as HTMLTextAreaElement
    const sendButton = document.getElementById('__sf_send') as HTMLButtonElement
    const annotateButton = document.getElementById('__sf_annotate') as HTMLButtonElement
    const screenshotIndicator = document.getElementById(
      '__sf_screenshot_indicator',
    ) as HTMLDivElement
    const status = document.getElementById('__sf_status') as HTMLDivElement
    const detailsToggle = document.getElementById('__sf_details_toggle') as HTMLButtonElement
    const detailsPanel = document.getElementById('__sf_controls') as HTMLDivElement

    expect(document.activeElement).toBe(textarea)
    expect(sendButton.disabled).toBe(true)
    expect(screenshotIndicator.textContent).toMatch(/screenshot ready/i)
    expect(status.textContent).toMatch(/screenshot attached/i)
    expect(annotateButton.textContent).toMatch(/annotate/i)
    expect(detailsToggle.textContent).toMatch(/details/i)
    expect(detailsToggle.getAttribute('aria-expanded')).toBe('false')
    expect(detailsPanel.style.display).toBe('none')

    textarea.value = 'Needs more spacing between the chips and the textarea.'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))

    expect(sendButton.disabled).toBe(false)
  })

  it('keeps the dialog interactive while screenshot capture is still pending', async () => {
    let resolveCapture: (canvas: HTMLCanvasElement) => void = () => {}
    vi.mocked(html2canvas).mockImplementationOnce(
      () =>
        new Promise<HTMLCanvasElement>((resolve) => {
          resolveCapture = resolve
        }),
    )

    const target = createTarget()
    showFeedbackDialog(target, 120, 80)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()

    const textarea = document.getElementById('__sf_text') as HTMLTextAreaElement
    const screenshotIndicator = document.getElementById(
      '__sf_screenshot_indicator',
    ) as HTMLDivElement
    const status = document.getElementById('__sf_status') as HTMLDivElement

    expect(textarea).not.toBeNull()
    expect(screenshotIndicator.textContent).toMatch(/screenshot loading/i)
    expect(screenshotIndicator.getAttribute('aria-busy')).toBe('true')
    expect(status.textContent).toMatch(/preparing screenshot in the background/i)
    expect(vi.mocked(html2canvas)).toHaveBeenCalledOnce()

    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 600
    resolveCapture(canvas)

    await flushUi()

    expect(screenshotIndicator.textContent).toMatch(/screenshot ready/i)
    expect(screenshotIndicator.getAttribute('aria-busy')).toBe('false')
    expect(status.textContent).toMatch(/screenshot attached/i)
  })

  it('excludes the snapfeed feedback dialog from the screenshot', async () => {
    const target = createTarget()
    showFeedbackDialog(target, 120, 80)
    await flushUi()

    expect(vi.mocked(html2canvas)).toHaveBeenCalled()
    const opts = vi.mocked(html2canvas).mock.calls[0][1] as
      | { ignoreElements?: (el: Element) => boolean }
      | undefined
    expect(opts?.ignoreElements).toBeTypeOf('function')

    const overlay = document.querySelector(
      '[data-snapfeed-overlay="feedback-dialog"]',
    ) as HTMLElement
    const otherEl = document.body
    expect(opts?.ignoreElements?.(overlay)).toBe(true)
    expect(opts?.ignoreElements?.(otherEl)).toBe(false)
  })

  it('honors screenshot and context toggles in the queued payload', async () => {
    const pushSpy = vi.spyOn(queue, 'push').mockImplementation(() => {})
    vi.spyOn(queue, 'flush').mockResolvedValue(true)

    const target = createTarget()
    showFeedbackDialog(target, 120, 80)
    await flushUi()

    const textarea = document.getElementById('__sf_text') as HTMLTextAreaElement
    const detailsToggle = document.getElementById('__sf_details_toggle') as HTMLButtonElement
    const screenshotToggle = document.getElementById('__sf_include_screenshot') as HTMLInputElement
    const contextToggle = document.getElementById('__sf_include_context') as HTMLInputElement
    const screenshotIndicator = document.getElementById(
      '__sf_screenshot_indicator',
    ) as HTMLDivElement
    const sendButton = document.getElementById('__sf_send') as HTMLButtonElement

    detailsToggle.click()

    screenshotToggle.checked = false
    screenshotToggle.dispatchEvent(new Event('change', { bubbles: true }))
    contextToggle.checked = false
    contextToggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(screenshotIndicator.textContent).toMatch(/screenshot off/i)
    expect(screenshotIndicator.getAttribute('aria-busy')).toBe('false')

    textarea.value = 'Skip attachments for this quick note.'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    sendButton.click()
    await flushUi()

    expect(pushSpy).toHaveBeenCalledWith(
      'feedback',
      'Skip attachments for this quick note.',
      expect.objectContaining({
        screenshot_included: false,
        page_context_included: false,
      }),
      null,
    )
    expect(pushSpy.mock.calls[0]?.[2]).not.toHaveProperty('path')
    expect(pushSpy.mock.calls[0]?.[2]).not.toHaveProperty('url')
  })

  it('expands and collapses the details disclosure', async () => {
    const target = createTarget()

    showFeedbackDialog(target, 120, 80)
    await flushUi()

    const detailsToggle = document.getElementById('__sf_details_toggle') as HTMLButtonElement
    const detailsPanel = document.getElementById('__sf_controls') as HTMLDivElement

    expect(detailsToggle.getAttribute('aria-expanded')).toBe('false')
    expect(detailsPanel.style.display).toBe('none')

    detailsToggle.click()

    expect(detailsToggle.getAttribute('aria-expanded')).toBe('true')
    expect(detailsPanel.style.display).toBe('flex')
    expect(detailsToggle.textContent).toMatch(/screenshot on/i)

    detailsToggle.click()

    expect(detailsToggle.getAttribute('aria-expanded')).toBe('false')
    expect(detailsPanel.style.display).toBe('none')
  })

  it('shows a payload preview that tracks the current feedback state', async () => {
    const target = createTarget()

    showFeedbackDialog(target, 120, 80)
    await flushUi()

    const textarea = document.getElementById('__sf_text') as HTMLTextAreaElement
    const detailsToggle = document.getElementById('__sf_details_toggle') as HTMLButtonElement
    const payloadToggle = document.getElementById('__sf_payload_toggle') as HTMLButtonElement
    const payloadPreview = document.getElementById('__sf_payload_preview') as HTMLPreElement
    const contextToggle = document.getElementById('__sf_include_context') as HTMLInputElement

    detailsToggle.click()
    textarea.value = 'Preview this payload'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    payloadToggle.click()

    expect(payloadToggle.getAttribute('aria-expanded')).toBe('true')
    expect(payloadPreview.style.display).toBe('block')
    expect(payloadPreview.textContent).toMatch(/"event_type": "feedback"/)
    expect(payloadPreview.textContent).toMatch(/"target": "Preview this payload"/)
    expect(payloadPreview.textContent).toMatch(/"path"/)

    contextToggle.checked = false
    contextToggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(payloadPreview.textContent).toMatch(/"page_context_included": false/)
    expect(payloadPreview.textContent).not.toMatch(/"path"/)
  })

  it('defers plugin enrichment until the payload preview requests full context', async () => {
    vi.mocked(enrichElement).mockReturnValue({
      componentName: 'FeedbackReviewCard',
      fileName: 'src/App.tsx',
      lineNumber: 192,
      columnNumber: 7,
    })

    const target = createTarget()

    showFeedbackDialog(target, 120, 80)
    await flushUi()

    expect(enrichElement).not.toHaveBeenCalled()

    const detailsToggle = document.getElementById('__sf_details_toggle') as HTMLButtonElement
    const payloadToggle = document.getElementById('__sf_payload_toggle') as HTMLButtonElement
    const payloadPreview = document.getElementById('__sf_payload_preview') as HTMLPreElement

    detailsToggle.click()
    payloadToggle.click()

    expect(enrichElement).toHaveBeenCalledWith(target)
    expect(payloadPreview.textContent).toMatch(/"component": "FeedbackReviewCard"/)
    expect(payloadPreview.textContent).toMatch(/"source_file": "src\/App.tsx"/)
    expect(payloadPreview.textContent).toMatch(/"source_line": 192/)
  })

  it('defers the global form-state scan until context payload is requested', async () => {
    const querySelectorAllSpy = vi.spyOn(document, 'querySelectorAll')
    const target = createTarget()

    showFeedbackDialog(target, 120, 80)
    await flushUi()

    const detailsToggle = document.getElementById('__sf_details_toggle') as HTMLButtonElement
    const payloadToggle = document.getElementById('__sf_payload_toggle') as HTMLButtonElement
    const formStateSelector =
      'input:not([type="hidden"]):not([type="password"]), select, textarea, [role="combobox"], [role="slider"]'

    expect(querySelectorAllSpy).not.toHaveBeenCalledWith(formStateSelector)

    detailsToggle.click()
    payloadToggle.click()

    expect(querySelectorAllSpy).toHaveBeenCalledWith(formStateSelector)
  })

  it('shows a warning state when the backend flush fails', async () => {
    vi.spyOn(queue, 'push').mockImplementation(() => {})
    vi.spyOn(queue, 'flush').mockResolvedValue(false)

    const target = createTarget()
    showFeedbackDialog(target, 120, 80)
    await flushUi()

    const textarea = document.getElementById('__sf_text') as HTMLTextAreaElement
    const sendButton = document.getElementById('__sf_send') as HTMLButtonElement
    const status = document.getElementById('__sf_status') as HTMLDivElement

    textarea.value = 'This should stay queued locally if delivery fails.'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    sendButton.click()
    await flushUi()

    expect(status.textContent).toMatch(/saved locally/i)
    expect(sendButton.textContent).toBe('Close')
  })

  it('repositions the overlay back into the visual viewport on resize', async () => {
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    const target = createTarget()

    showFeedbackDialog(target, 460, 360)
    await flushUi()

    const overlay = document.querySelector(
      '[data-snapfeed-overlay="feedback-dialog"]',
    ) as HTMLDivElement

    mockOverlayRect(overlay, 280, 260)
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 540,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 420,
    })

    window.dispatchEvent(new Event('resize'))
    await flushUi()

    expect(Number.parseFloat(overlay.style.left)).toBeLessThanOrEqual(248)
    expect(Number.parseFloat(overlay.style.top)).toBeLessThanOrEqual(148)

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    })
  })

  it('applies a custom theme from config to the overlay UI', async () => {
    initFeedback(
      resolveConfig({
        feedback: { enabled: true },
        theme: {
          accent: '#0f6cbd',
          panelBackground: '#f5f9ff',
          panelText: '#12344d',
        },
      }),
    )

    const target = createTarget()

    showFeedbackDialog(target, 120, 80)
    await flushUi()

    const overlay = document.querySelector(
      '[data-snapfeed-overlay="feedback-dialog"]',
    ) as HTMLDivElement

    expect(overlay.style.background).toBe('rgb(245, 249, 255)')
    expect(overlay.style.color).toBe('rgb(18, 52, 77)')
    expect(overlay.innerHTML).toContain('#0f6cbd')
  })
})

describe('feedback controller', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(enrichElement).mockReset()
    vi.mocked(enrichElement).mockReturnValue(null)
    vi.mocked(html2canvas).mockReset()
    vi.mocked(html2canvas).mockImplementation(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 600
      return canvas
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createCanvasContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,ZmFrZS1pbWFnZQ==',
    )
    initFeedback(
      resolveConfig({
        endpoint: '/api/test-feedback',
        feedback: {
          enabled: true,
          annotations: true,
          allowScreenshotToggle: true,
          allowContextToggle: true,
        },
        captureConsoleErrors: true,
      }),
    )
  })

  afterEach(() => {
    dismissFeedbackDialog()
    document.body.innerHTML = ''
  })

  it('creates a headless controller that exposes payload preview and submit state', async () => {
    const pushSpy = vi.spyOn(queue, 'push').mockImplementation(() => {})
    vi.spyOn(queue, 'flush').mockResolvedValue(true)

    const target = createTarget()
    const controller = createFeedbackController({
      element: target,
      x: 120,
      y: 80,
    })

    expect(controller.getSnapshot().screenshotState).toBe('pending')

    await flushUi()

    controller.setText('Controller-submitted feedback')
    controller.setIncludeContext(false)

    expect(controller.getPayloadPreview()).toEqual(
      expect.objectContaining({
        event_type: 'feedback',
        target: 'Controller-submitted feedback',
        screenshot: '[base64 screenshot attached]',
      }),
    )

    const result = await controller.submit()

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'complete',
        tone: 'success',
      }),
    )
    expect(pushSpy).toHaveBeenCalledWith(
      'feedback',
      'Controller-submitted feedback',
      expect.objectContaining({
        screenshot_included: true,
        page_context_included: false,
      }),
      expect.any(String),
    )
  })

  it('routes Cmd/Ctrl-click into a custom trigger handler without opening the overlay', async () => {
    const onTrigger = vi.fn()
    initFeedback(
      resolveConfig({
        endpoint: '/api/test-feedback',
        feedback: {
          enabled: false,
          onTrigger,
        },
      }),
    )

    const target = createTarget()
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: 32,
      clientY: 48,
      metaKey: true,
    })
    Object.defineProperty(event, 'target', {
      configurable: true,
      value: target,
    })

    expect(getFeedbackTrigger(event)).toEqual({
      element: target,
      x: 32,
      y: 48,
    })

    handleCtrlClick(event)
    await flushUi()

    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(onTrigger.mock.calls[0]?.[1]).toEqual({
      element: target,
      x: 32,
      y: 48,
    })
    expect(document.querySelector('[data-snapfeed-overlay="feedback-dialog"]')).toBeNull()
  })

  async function submitWithAdapters(adapters: FeedbackAdapter[]) {
    vi.spyOn(queue, 'push').mockImplementation(() => {})
    vi.spyOn(queue, 'flush').mockResolvedValue(true)
    initFeedback(resolveConfig({ adapters, feedback: { defaultIncludeScreenshot: false } }))
    const controller = createFeedbackController({ element: createTarget(), x: 0, y: 0 })
    showFeedbackDialog(controller)
    controller.setText('Security regression')
    const completion = await controller.submit()
    const status = document.getElementById('__sf_status')
    expect(status).not.toBeNull()
    return { completion, status: status! }
  }

  it('renders adapter names, IDs and failures literally without HTML in the completion message', async () => {
    const name = '<img src=x onerror=alert(1)>'
    const id = '<svg onload=alert(2)>'
    const failure = '<iframe srcdoc="<script>alert(3)</script>">'
    const { completion, status } = await submitWithAdapters([
      {
        name,
        send: async () => ({
          ok: true,
          deliveryId: id,
          deliveryUrl: 'https://example.com/issue/1',
        }),
      },
      { name: failure, send: async () => ({ ok: false }) },
    ])
    expect(completion).toEqual(
      expect.objectContaining({
        kind: 'complete',
        tone: 'warning',
        message: `Delivered via ${name} #${id}. Failed: ${failure}.`,
      }),
    )
    expect(status.querySelector('img, svg, iframe, script')).toBeNull()
    expect(status.textContent).toBe(`Delivered via ${name} #${id}. Failed: ${failure}.`)
    expect(status.querySelector('a')?.textContent).toBe(`${name} #${id}`)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    '\u0000javascript:alert(1)',
    'data:text/html,<svg onload=alert(1)>',
    'vbscript:alert(1)',
    'file:///tmp/report',
    'https://[invalid',
  ])('does not create a link for unsafe deliveryUrl %s', async (deliveryUrl) => {
    const { status } = await submitWithAdapters([
      { name: 'custom', send: async () => ({ ok: true, deliveryId: '7', deliveryUrl }) },
    ])
    expect(status.querySelector('a')).toBeNull()
    expect(status.textContent).toBe('Feedback delivered via custom #7.')
  })

  it('does not parse quotes or markup in a delivery URL as HTML', async () => {
    const deliveryUrl = 'https://example.com/" onclick="alert(1)"><img src=x onerror=alert(2)>'
    const { status } = await submitWithAdapters([
      { name: 'custom', send: async () => ({ ok: true, deliveryUrl }) },
    ])
    expect(status.querySelector('img')).toBeNull()
    const link = status.querySelector('a')
    expect(link?.getAttribute('onclick')).toBeNull()
    expect(link?.href).toBe(new URL(deliveryUrl, document.baseURI).href)
  })

  it.each([
    'https://example.com/issues/7',
    'http://localhost:8420/report/7',
    '/reports/7',
  ])('keeps safe delivery links clickable: %s', async (deliveryUrl) => {
    const { status } = await submitWithAdapters([
      { name: 'custom', send: async () => ({ ok: true, deliveryId: '7', deliveryUrl }) },
    ])
    const link = status.querySelector('a')
    expect(link?.href).toBe(new URL(deliveryUrl, document.baseURI).href)
    expect(link?.textContent).toBe('custom #7')
    expect(link?.target).toBe('_blank')
    expect(link?.rel).toContain('noopener')
  })

  it('keeps mixed successful, failed and rejected adapter delivery messages', async () => {
    const { completion, status } = await submitWithAdapters([
      {
        name: 'linked',
        send: async () => ({ ok: true, deliveryId: '1', deliveryUrl: '/reports/1' }),
      },
      { name: 'plain', send: async () => ({ ok: true, deliveryId: '2' }) },
      { name: 'failed', send: async () => ({ ok: false }) },
      {
        name: 'rejected',
        send: async () => {
          throw new Error('Delivery failed')
        },
      },
    ])
    expect(completion).toEqual(expect.objectContaining({ kind: 'complete', tone: 'warning' }))
    expect(status.textContent).toBe('Delivered via linked #1, plain #2. Failed: failed, adapter.')
    expect(status.querySelectorAll('a')).toHaveLength(1)
  })

  it('renders breadcrumb and target labels as literal text and titles', () => {
    const target = createTarget()
    const payload = '<img src=x onerror=alert(1)> & "quoted"'
    target.dataset.feedbackContext = payload
    target.setAttribute('aria-label', payload)
    const controller = createFeedbackController({ element: target, x: 0, y: 0 })
    showFeedbackDialog(controller)
    const overlay = document.querySelector('[data-snapfeed-overlay="feedback-dialog"]')
    expect(overlay?.querySelector('img')).toBeNull()
    expect(overlay?.textContent).toContain(payload)
    const titles = Array.from(overlay?.querySelectorAll('[title]') ?? []).map((el) =>
      el.getAttribute('title'),
    )
    expect(titles).toContain(controller.getSnapshot().breadcrumb)
    expect(titles).toContain(payload)
  })
})
