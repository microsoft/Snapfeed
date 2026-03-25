import { showAnnotationCanvas } from './annotation.js'
import { getConsoleErrors } from './console-capture.js'
import { getLabel, getPath, getText } from './helpers.js'
import { enrichElement } from './plugins.js'
import { flush, getSessionId, push } from './queue.js'
import { sanitizeDetail } from './sanitize.js'
import type {
  FeedbackCategory,
  FeedbackController,
  FeedbackControllerSnapshot,
  FeedbackScreenshotState,
  FeedbackSubmitState,
  FeedbackTrigger,
  ResolvedConfig,
  TelemetryEvent,
} from './types.js'

const FORM_STATE_SELECTOR =
  'input:not([type="hidden"]):not([type="password"]), select, textarea, [role="combobox"], [role="slider"]'
const RESERVED_ENRICHMENT_KEYS = new Set([
  'componentName',
  'fileName',
  'lineNumber',
  'columnNumber',
])

interface ControllerState {
  text: string
  category: FeedbackCategory
  includeScreenshot: boolean
  includeContext: boolean
  screenshotState: FeedbackScreenshotState
  screenshotData: string | null
  submitState: FeedbackSubmitState
  fullContext: Record<string, unknown> | null
  disposed: boolean
}

// html2canvas is a peer dependency — loaded lazily
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let html2canvasFn: ((el: HTMLElement, opts?: unknown) => Promise<HTMLCanvasElement>) | null = null

async function loadHtml2Canvas(): Promise<typeof html2canvasFn> {
  if (html2canvasFn) return html2canvasFn
  try {
    const mod = await import('html2canvas')
    html2canvasFn = (mod.default ?? mod) as unknown as typeof html2canvasFn
    return html2canvasFn
  } catch {
    return null
  }
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Feedback screenshot canvas context is unavailable')
  }

  return context
}

function applyEnrichment(ctx: Record<string, unknown>, el: Element): void {
  const enrichment = enrichElement(el)
  if (!enrichment) return

  if (enrichment.componentName) ctx.component = enrichment.componentName
  if (enrichment.fileName) ctx.source_file = enrichment.fileName
  if (enrichment.lineNumber) ctx.source_line = enrichment.lineNumber
  if (enrichment.columnNumber) ctx.source_column = enrichment.columnNumber

  for (const key in enrichment) {
    if (!Object.hasOwn(enrichment, key)) continue
    if (RESERVED_ENRICHMENT_KEYS.has(key)) continue
    ctx[`plugin_${key}`] = enrichment[key]
  }
}

function gatherBaseContext(el: Element): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    tag: el.tagName.toLowerCase(),
    path: getPath(el),
    text: getText(el),
    label: getLabel(el),
  }

  applyEnrichment(ctx, el)

  let current: Element | null = el
  while (current && current !== document.body) {
    for (let index = 0; index < current.attributes.length; index++) {
      const attr = current.attributes[index]
      if (attr.name.startsWith('data-') && !ctx[attr.name]) {
        ctx[attr.name] = attr.value
      }
    }

    if (current.tagName === 'IMG' && !ctx.img_src) {
      ctx.img_src = (current as HTMLImageElement).src.replace(window.location.origin, '')
    }

    current = current.parentElement
  }

  const dialog = document.querySelector('[role="dialog"], .MuiDialog-root')
  if (dialog) {
    ctx.dialog_open = true
    const title = dialog.querySelector('h2, h3, h4, h5, h6, [class*="title"]')
    if (title) ctx.dialog_title = (title as HTMLElement).innerText?.trim().substring(0, 100)
  }

  ctx.url = window.location.pathname + window.location.search
  return ctx
}

function gatherFormState(): Record<string, string> | null {
  const formState: Record<string, string> = {}
  let hasFormState = false

  const inputs = document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(FORM_STATE_SELECTOR)
  for (const input of inputs) {
    if (!input.offsetParent && input.tagName !== 'INPUT') continue

    const label =
      input.getAttribute('aria-label') ||
      input.closest('[class*="FormControl"]')?.querySelector('label')?.textContent?.trim() ||
      input.name ||
      input.id ||
      ''
    if (!label) continue

    let value = ''
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      value = input.checked ? 'true' : 'false'
    } else if (input.getAttribute('role') === 'slider') {
      value = input.getAttribute('aria-valuenow') || input.getAttribute('aria-valuetext') || ''
    } else {
      value = input.value || ''
    }
    if (!value) continue

    formState[label.substring(0, 40)] = value.substring(0, 100)
    hasFormState = true
  }

  return hasFormState ? formState : null
}

function buildBreadcrumb(baseContext: Record<string, unknown>): string {
  const crumbs: string[] = []
  const page = window.location.pathname.split('/').filter(Boolean)
  crumbs.push(...page)

  if (baseContext['data-feedback-context']) {
    crumbs.push(baseContext['data-feedback-context'] as string)
  }
  if (baseContext.dialog_open) crumbs.push('dialog')
  if (baseContext['data-index'] != null) crumbs.push(`burst:${baseContext['data-index']}`)
  if (baseContext.img_src) {
    const fileName = (baseContext.img_src as string).split('/').pop()?.split('?')[0]
    if (fileName) crumbs.push(fileName)
  }
  if (baseContext.component) crumbs.push(`<${baseContext.component as string}>`)

  return crumbs.join(' › ') || 'page'
}

async function captureScreenshot(
  config: ResolvedConfig,
  clickX: number,
  clickY: number,
): Promise<string | null> {
  const html2canvas = await loadHtml2Canvas()
  if (!html2canvas) return null

  try {
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      scale: 1,
      logging: false,
      backgroundColor: config.feedback.backgroundColor,
    } as unknown)

    const maxWidth = config.feedback.screenshotMaxWidth
    let finalCanvas = canvas
    if (canvas.width > maxWidth) {
      const ratio = maxWidth / canvas.width
      const scaled = document.createElement('canvas')
      scaled.width = maxWidth
      scaled.height = Math.round(canvas.height * ratio)
      const scaledContext = getCanvasContext(scaled)
      scaledContext.drawImage(canvas, 0, 0, scaled.width, scaled.height)
      finalCanvas = scaled
    }

    const scaleX = finalCanvas.width / window.innerWidth
    const scaleY = finalCanvas.height / window.innerHeight
    const markerX = clickX * scaleX
    const markerY = clickY * scaleY
    const context = getCanvasContext(finalCanvas)

    context.strokeStyle = '#ff0000'
    context.lineWidth = 3
    context.beginPath()
    context.arc(markerX, markerY, 20, 0, Math.PI * 2)
    context.stroke()
    context.fillStyle = '#ff0000'
    context.beginPath()
    context.arc(markerX, markerY, 4, 0, Math.PI * 2)
    context.fill()
    context.beginPath()
    context.moveTo(markerX - 30, markerY)
    context.lineTo(markerX - 8, markerY)
    context.moveTo(markerX + 8, markerY)
    context.lineTo(markerX + 30, markerY)
    context.moveTo(markerX, markerY - 30)
    context.lineTo(markerX, markerY - 8)
    context.moveTo(markerX, markerY + 8)
    context.lineTo(markerX, markerY + 30)
    context.stroke()

    const dataUrl = finalCanvas.toDataURL('image/jpeg', config.feedback.screenshotQuality)
    return dataUrl.split(',')[1] || null
  } catch (err) {
    console.warn('[snapfeed] Screenshot capture failed:', err)
    return null
  }
}

function getNetworkLogEntries(): unknown[] {
  const netLog = (window as unknown as Record<string, unknown>).__snapfeedNetworkLog as {
    getEntries?: () => unknown[]
  } | null

  return netLog?.getEntries?.() ?? []
}

function getSessionReplayEvents(): unknown[] {
  const replay = (window as unknown as Record<string, unknown>).__snapfeedSessionReplay as {
    getEvents?: () => unknown[]
  } | null

  return replay?.getEvents?.() ?? []
}

function createAdapterEvent(
  text: string,
  detail: Record<string, unknown>,
  screenshot: string | null,
): TelemetryEvent {
  return {
    session_id: getSessionId(),
    seq: -1,
    ts: new Date().toISOString(),
    event_type: 'feedback',
    page: window.location.pathname,
    target: text,
    detail,
    screenshot,
  }
}

export function gatherContext(el: Element): Record<string, unknown> {
  const ctx = gatherBaseContext(el)
  const formState = gatherFormState()
  if (formState) ctx.form_state = formState

  return ctx
}

export function createHeadlessFeedbackController(
  config: ResolvedConfig,
  trigger: FeedbackTrigger,
): FeedbackController {
  const baseContext = gatherBaseContext(trigger.element)
  const listeners = new Set<(snapshot: FeedbackControllerSnapshot) => void>()
  const state: ControllerState = {
    text: '',
    category: 'bug',
    includeScreenshot: config.feedback.defaultIncludeScreenshot,
    includeContext: config.feedback.defaultIncludeContext,
    screenshotState: 'pending',
    screenshotData: null,
    submitState: { kind: 'idle' },
    fullContext: null,
    disposed: false,
  }

  const breadcrumb = buildBreadcrumb(baseContext)
  const targetLabel = (
    (baseContext.label as string) ||
    (baseContext.tag as string) ||
    ''
  ).substring(0, 60)
  const pendingScreenshot = captureScreenshot(config, trigger.x, trigger.y)

  const getSnapshot = (): FeedbackControllerSnapshot => ({
    x: trigger.x,
    y: trigger.y,
    text: state.text,
    category: state.category,
    includeScreenshot: state.includeScreenshot,
    includeContext: state.includeContext,
    screenshotState: state.screenshotState,
    submitState: state.submitState,
    breadcrumb,
    targetLabel,
  })

  const notify = () => {
    if (state.disposed) return

    const snapshot = getSnapshot()
    for (const listener of listeners) {
      listener(snapshot)
    }
  }

  const getFullContext = (): Record<string, unknown> => {
    if (state.fullContext) return state.fullContext

    const nextContext = { ...baseContext }
    const formState = gatherFormState()
    if (formState) nextContext.form_state = formState
    state.fullContext = nextContext
    return nextContext
  }

  const getSanitizedDetail = (): Record<string, unknown> => {
    const detail: Record<string, unknown> = {
      category: state.category,
      screenshot_included: state.includeScreenshot,
      page_context_included: state.includeContext,
    }

    if (config.user) detail.user = config.user
    if (!state.includeContext) {
      return sanitizeDetail(detail)
    }

    Object.assign(detail, getFullContext())

    const consoleErrors = getConsoleErrors()
    if (consoleErrors.length > 0) detail.console_errors = consoleErrors

    const networkLogEntries = getNetworkLogEntries()
    if (networkLogEntries.length > 0) detail.network_log = networkLogEntries

    const replayEvents = getSessionReplayEvents()
    if (replayEvents.length > 0) detail.replay_data = replayEvents

    return sanitizeDetail(detail)
  }

  const ensureScreenshot = async (): Promise<string | null> => {
    const screenshot = state.screenshotData ?? (await pendingScreenshot)
    if (state.disposed) return screenshot

    state.screenshotData = screenshot
    if (!screenshot) {
      state.screenshotState = 'unavailable'
      state.includeScreenshot = false
    } else {
      state.screenshotState = 'ready'
    }

    notify()
    return screenshot
  }

  void pendingScreenshot.then((screenshot) => {
    if (state.disposed) return

    state.screenshotData = screenshot
    if (!screenshot) {
      state.screenshotState = 'unavailable'
      state.includeScreenshot = false
    } else {
      state.screenshotState = 'ready'
    }

    notify()
  })

  return {
    getSnapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    setText(text) {
      if (state.submitState.kind !== 'idle') return
      state.text = text
      notify()
    },

    setCategory(category) {
      if (state.submitState.kind !== 'idle') return
      state.category = category
      notify()
    },

    setIncludeScreenshot(include) {
      if (state.submitState.kind !== 'idle') return
      if (include && state.screenshotState === 'unavailable') return
      state.includeScreenshot = include
      notify()
    },

    setIncludeContext(include) {
      if (state.submitState.kind !== 'idle') return
      state.includeContext = include
      notify()
    },

    getPayloadPreview() {
      return {
        event_type: 'feedback',
        page: window.location.pathname,
        target: state.text.trim() || null,
        detail: getSanitizedDetail(),
        screenshot: state.includeScreenshot
          ? state.screenshotState === 'ready'
            ? '[base64 screenshot attached]'
            : state.screenshotState === 'pending'
              ? '[screenshot capture pending]'
              : null
          : null,
      }
    },

    getScreenshot() {
      return state.screenshotData
    },

    async annotate() {
      if (!config.feedback.annotations) return false
      if (!state.includeScreenshot) return false
      if (state.submitState.kind !== 'idle') return false

      const screenshot = await ensureScreenshot()
      if (!screenshot || state.disposed) return false

      const annotated = await showAnnotationCanvas(screenshot, config.feedback.screenshotQuality)
      if (!annotated || state.disposed) return false

      state.screenshotData = annotated
      state.screenshotState = 'ready'
      notify()
      return true
    },

    async submit() {
      if (state.submitState.kind === 'submitting') return state.submitState
      if (state.submitState.kind === 'complete') return state.submitState

      const text = state.text.trim()
      if (!text) return state.submitState

      state.submitState = { kind: 'submitting' }
      notify()

      let screenshot: string | null = null
      if (state.includeScreenshot) {
        screenshot = await ensureScreenshot()
        if (state.disposed) return state.submitState
      }

      const detail = getSanitizedDetail()
      push('feedback', text, detail, state.includeScreenshot ? screenshot : null)

      const flushOk = await flush()
      if (state.disposed) return state.submitState

      const adapterResults = await Promise.allSettled(
        config.adapters.map(async (adapter) => ({
          name: adapter.name,
          result: await adapter.send(
            createAdapterEvent(text, detail, state.includeScreenshot ? screenshot : null),
          ),
        })),
      )
      if (state.disposed) return state.submitState

      const adapterFailures = adapterResults.flatMap((entry) => {
        if (entry.status === 'rejected') return ['adapter']
        return entry.value.result.ok ? [] : [entry.value.name]
      })

      if (!flushOk || adapterFailures.length > 0) {
        state.submitState = {
          kind: 'complete',
          tone: 'warning',
          message: [
            flushOk
              ? 'Feedback saved and sent from this page.'
              : 'Feedback saved locally. Server delivery will retry automatically.',
            adapterFailures.length > 0
              ? `Adapter delivery failed: ${adapterFailures.join(', ')}.`
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        }
      } else {
        state.submitState = {
          kind: 'complete',
          tone: 'success',
          message: state.includeScreenshot
            ? 'Feedback sent with the current screenshot attached.'
            : 'Feedback sent without a screenshot.',
        }
      }

      notify()
      return state.submitState
    },

    dispose() {
      state.disposed = true
      listeners.clear()
    },
  }
}
