/**
 * Feedback dialog — Cmd+Click visual feedback with screenshots.
 *
 * When the user Cmd+Clicks an element, this module:
 * 1. Gathers DOM context (data attributes, nearby images, dialog state)
 * 2. Captures a full-page screenshot with a click-position marker
 * 3. Shows a positioned dialog for the user to type feedback
 * 4. Pushes a 'feedback' telemetry event with context + screenshot
 */

import { showAnnotationCanvas } from './annotation.js'
import { getConsoleErrors } from './console-capture.js'
import { getLabel, getPath, getText } from './helpers.js'
import { enrichElement } from './plugins.js'
import { flush, push } from './queue.js'
import { sanitizeDetail } from './sanitize.js'
import type { FeedbackCategory, ResolvedConfig } from './types.js'
import { FEEDBACK_CATEGORIES } from './types.js'
import { getSnapfeedTheme } from './ui-theme.js'

let feedbackOverlay: HTMLDivElement | null = null
let pendingScreenshot: Promise<string | null> | null = null
let currentConfig: ResolvedConfig | null = null

export function dismissFeedbackDialog(): void {
  feedbackOverlay?.remove()
  feedbackOverlay = null
}

// html2canvas is a peer dependency — loaded lazily
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let html2canvasFn: ((el: HTMLElement, opts?: unknown) => Promise<HTMLCanvasElement>) | null = null

async function loadHtml2Canvas(): Promise<typeof html2canvasFn> {
  if (html2canvasFn) return html2canvasFn
  try {
    // Dynamic import — works even if html2canvas is not installed
    const mod = await import('html2canvas')
    html2canvasFn = (mod.default ?? mod) as unknown as typeof html2canvasFn
    return html2canvasFn
  } catch {
    return null
  }
}

// ── Context gathering ────────────────────────────────────────────────

export function gatherContext(el: Element): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    tag: el.tagName.toLowerCase(),
    path: getPath(el),
    text: getText(el),
    label: getLabel(el),
  }

  // Plugin enrichment (React component names, file paths, etc.)
  const enrichment = enrichElement(el)
  if (enrichment) {
    if (enrichment.componentName) ctx.component = enrichment.componentName
    if (enrichment.fileName) ctx.source_file = enrichment.fileName
    if (enrichment.lineNumber) ctx.source_line = enrichment.lineNumber
    if (enrichment.columnNumber) ctx.source_column = enrichment.columnNumber
    // Spread any extra plugin data
    for (const [key, value] of Object.entries(enrichment)) {
      if (!['componentName', 'fileName', 'lineNumber', 'columnNumber'].includes(key)) {
        ctx[`plugin_${key}`] = value
      }
    }
  }

  // Walk up to find data attributes
  let cur: Element | null = el
  while (cur && cur !== document.body) {
    for (const attr of Array.from(cur.attributes)) {
      if (attr.name.startsWith('data-') && !ctx[attr.name]) {
        ctx[attr.name] = attr.value
      }
    }
    if (cur.tagName === 'IMG' && !ctx.img_src) {
      ctx.img_src = (cur as HTMLImageElement).src.replace(window.location.origin, '')
    }
    cur = cur.parentElement
  }

  // Capture any open dialog content
  const dialog = document.querySelector('[role="dialog"], .MuiDialog-root')
  if (dialog) {
    ctx.dialog_open = true
    const title = dialog.querySelector('h2, h3, h4, h5, h6, [class*="title"]')
    if (title) ctx.dialog_title = (title as HTMLElement).innerText?.trim().substring(0, 100)
  }

  // Capture visible form/filter state (inputs, selects, checkboxes, sliders)
  const formState: Record<string, string> = {}
  const inputs = document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(
    'input:not([type="hidden"]):not([type="password"]), select, textarea, [role="combobox"], [role="slider"]',
  )
  for (const inp of inputs) {
    // Skip invisible elements
    if (!inp.offsetParent && inp.tagName !== 'INPUT') continue
    const label =
      inp.getAttribute('aria-label') ||
      inp.closest('[class*="FormControl"]')?.querySelector('label')?.textContent?.trim() ||
      inp.name ||
      inp.id ||
      ''
    if (!label) continue
    let value = ''
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') {
      value = inp.checked ? 'true' : 'false'
    } else if (inp.getAttribute('role') === 'slider') {
      value = inp.getAttribute('aria-valuenow') || inp.getAttribute('aria-valuetext') || ''
    } else {
      value = inp.value || ''
    }
    if (value) formState[label.substring(0, 40)] = value.substring(0, 100)
  }
  if (Object.keys(formState).length > 0) ctx.form_state = formState

  ctx.url = window.location.pathname + window.location.search

  return ctx
}

// ── Screenshot capture ───────────────────────────────────────────────

async function captureScreenshot(clickX: number, clickY: number): Promise<string | null> {
  if (!currentConfig) return null
  const html2canvas = await loadHtml2Canvas()
  if (!html2canvas) return null

  try {
    if (feedbackOverlay) feedbackOverlay.style.display = 'none'

    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      scale: 1,
      logging: false,
      backgroundColor: currentConfig.feedback.backgroundColor,
      ignoreElements: (el: Element) => el === feedbackOverlay,
    } as unknown)

    if (feedbackOverlay) feedbackOverlay.style.display = ''

    // Scale down if wider than max
    const maxWidth = currentConfig.feedback.screenshotMaxWidth
    let finalCanvas = canvas
    if (canvas.width > maxWidth) {
      const ratio = maxWidth / canvas.width
      const scaled = document.createElement('canvas')
      scaled.width = maxWidth
      scaled.height = Math.round(canvas.height * ratio)
      const sctx = scaled.getContext('2d')!
      sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height)
      finalCanvas = scaled
    }

    // Draw click position marker (red crosshair)
    const scaleX = finalCanvas.width / window.innerWidth
    const scaleY = finalCanvas.height / window.innerHeight
    const mx = clickX * scaleX
    const my = clickY * scaleY
    const ctx = finalCanvas.getContext('2d')!

    ctx.strokeStyle = '#ff0000'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(mx, my, 20, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#ff0000'
    ctx.beginPath()
    ctx.arc(mx, my, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(mx - 30, my)
    ctx.lineTo(mx - 8, my)
    ctx.moveTo(mx + 8, my)
    ctx.lineTo(mx + 30, my)
    ctx.moveTo(mx, my - 30)
    ctx.lineTo(mx, my - 8)
    ctx.moveTo(mx, my + 8)
    ctx.lineTo(mx, my + 30)
    ctx.stroke()

    const quality = currentConfig.feedback.screenshotQuality
    const dataUrl = finalCanvas.toDataURL('image/jpeg', quality)
    return dataUrl.split(',')[1] || null
  } catch (err) {
    console.warn('[snapfeed] Screenshot capture failed:', err)
    if (feedbackOverlay) feedbackOverlay.style.display = ''
    return null
  }
}

// ── Feedback dialog UI ───────────────────────────────────────────────

export function showFeedbackDialog(el: Element, x: number, y: number): void {
  dismissFeedbackDialog()

  const context = gatherContext(el)
  const theme = getSnapfeedTheme()

  // Start capturing screenshot immediately (async, runs while user types)
  pendingScreenshot = captureScreenshot(x, y)

  // Build breadcrumb from page + context
  const crumbs: string[] = []
  const page = window.location.pathname.split('/').filter(Boolean)
  crumbs.push(...page)
  if (context['data-feedback-context']) crumbs.push(context['data-feedback-context'] as string)
  if (context.dialog_open) crumbs.push('dialog')
  if (context['data-index'] != null) crumbs.push(`burst:${context['data-index']}`)
  if (context.img_src) {
    const fname = (context.img_src as string).split('/').pop()?.split('?')[0]
    if (fname) crumbs.push(fname)
  }
  // Include component name from plugin enrichment
  if (context.component) crumbs.push(`<${context.component as string}>`)
  const breadcrumb = crumbs.join(' › ') || 'page'

  let selectedCategory: FeedbackCategory = 'bug'

  feedbackOverlay = document.createElement('div')
  feedbackOverlay.dataset.snapfeedOverlay = 'feedback-dialog'
  feedbackOverlay.style.cssText = `
    position: fixed; z-index: 99999;
    left: ${Math.min(x, window.innerWidth - 380)}px;
    top: ${Math.min(y, window.innerHeight - 320)}px;
    width: 360px; padding: 12px;
    background: ${theme.panelBackground}; color: ${theme.panelText}; border: 1px solid ${theme.panelBorder};
    border-radius: ${theme.panelRadius}; box-shadow: ${theme.panelShadow};
    font-family: ${theme.fontFamily}; font-size: 13px;
  `
  // Stop ALL events from leaking out
  for (const evt of [
    'keydown',
    'keyup',
    'keypress',
    'mousedown',
    'mouseup',
    'click',
    'pointerdown',
    'pointerup',
    'focusin',
    'focusout',
  ]) {
    feedbackOverlay.addEventListener(evt, (e) => e.stopPropagation())
  }

  const targetLabel = ((context.label as string) || (context.tag as string) || '').substring(0, 60)

  // Build category chips HTML
  const chipsHtml = FEEDBACK_CATEGORIES.map(
    (c) =>
      `<button data-cat="${c.id}" style="padding:3px 10px; border-radius:12px; border:1px solid ${c.id === 'bug' ? theme.accent : theme.panelBorder};
      background:${c.id === 'bug' ? theme.accentSoft : 'transparent'}; color:${theme.panelText}; cursor:pointer;
      font-size:12px; font-family:inherit; white-space:nowrap;">${c.emoji} ${c.label}</button>`,
  ).join('')

  feedbackOverlay.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px">
      <span style="font-weight:600; color:${theme.accent}">📝 Feedback</span>
      <span style="color:${theme.mutedText}; font-size:10px; cursor:pointer" id="__sf_close">✕</span>
    </div>
    <div style="color:${theme.mutedText}; font-size:11px; margin-bottom:6px; line-height:1.4">
      <div style="margin-bottom:2px">${breadcrumb}</div>
      <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
        title="${targetLabel.replace(/"/g, '&quot;')}">→ ${targetLabel}</div>
    </div>
    <div id="__sf_chips" style="display:flex; gap:4px; margin-bottom:8px; flex-wrap:wrap">${chipsHtml}</div>
    <textarea id="__sf_text" rows="4" placeholder="What's wrong / what should change?"
      style="width:100%; box-sizing:border-box; background:${theme.inputBackground}; color:${theme.inputText}; border:1px solid ${theme.inputBorder};
             border-radius:${theme.panelRadius}; padding:8px; font-size:14px; resize:vertical; font-family:inherit;
             outline:none; min-height:80px;"
    ></textarea>
    <div style="display:flex; gap:6px; margin-top:8px; justify-content:flex-end; align-items:center">
      <span style="color:${theme.mutedText}; font-size:10px; flex:1">⌘+Enter to send · Esc to cancel</span>
      <button id="__sf_annotate" title="Annotate screenshot" style="padding:4px 8px; background:none; color:${theme.mutedText}; border:1px solid ${theme.panelBorder};
              border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px;">✏️</button>
      <button id="__sf_cancel" style="padding:4px 12px; background:none; color:${theme.mutedText}; border:1px solid ${theme.panelBorder};
              border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px;">Cancel</button>
      <button id="__sf_send" style="padding:4px 12px; background:${theme.accent}; color:${theme.accentContrast}; border:none;
              border-radius:${theme.panelRadius}; cursor:pointer; font-weight:600; font-size:12px;">Send</button>
    </div>
  `
  document.body.appendChild(feedbackOverlay)

  // Category chip click handling
  const chipsContainer = document.getElementById('__sf_chips')!
  chipsContainer.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-cat]') as HTMLButtonElement | null
    if (!btn) return
    selectedCategory = btn.dataset.cat as FeedbackCategory
    chipsContainer.querySelectorAll('button').forEach((b) => {
      const isActive = b.dataset.cat === selectedCategory
      b.style.border = `1px solid ${isActive ? theme.accent : theme.panelBorder}`
      b.style.background = isActive ? theme.accentSoft : 'transparent'
    })
  })

  const textarea = document.getElementById('__sf_text') as HTMLTextAreaElement
  const focusTextarea = () => textarea.focus()
  setTimeout(focusTextarea, 0)
  setTimeout(focusTextarea, 50)
  setTimeout(focusTextarea, 150)
  textarea.addEventListener('mousedown', () => setTimeout(focusTextarea, 0))

  const close = () => {
    dismissFeedbackDialog()
  }

  document.getElementById('__sf_cancel')!.onclick = close
  document.getElementById('__sf_close')!.onclick = close

  // Annotate button — opens annotation canvas on the screenshot
  document.getElementById('__sf_annotate')!.onclick = async () => {
    if (!currentConfig?.feedback.annotations) return
    const screenshot = await pendingScreenshot
    if (!screenshot) return
    feedbackOverlay!.style.display = 'none'
    const annotated = await showAnnotationCanvas(
      screenshot,
      currentConfig.feedback.screenshotQuality,
    )
    feedbackOverlay!.style.display = ''
    if (annotated) {
      pendingScreenshot = Promise.resolve(annotated)
    }
  }

  const submit = async () => {
    const text = textarea.value.trim()
    if (!text) {
      close()
      return
    }
    const screenshot = await pendingScreenshot

    // Enrich context with console errors and user identity
    const consoleErrors = getConsoleErrors()
    if (consoleErrors.length > 0) context.console_errors = consoleErrors
    if (currentConfig?.user) context.user = currentConfig.user
    context.category = selectedCategory

    // Sanitize before sending
    const sanitizedContext = sanitizeDetail(context as Record<string, unknown>)

    push('feedback', text, sanitizedContext, screenshot)
    flush()

    // Also send to adapters if configured
    if (currentConfig?.adapters.length) {
      const event = {
        session_id: '',
        seq: 0,
        ts: new Date().toISOString(),
        event_type: 'feedback',
        page: window.location.pathname,
        target: text,
        detail: sanitizedContext,
        screenshot,
      }
      for (const adapter of currentConfig.adapters) {
        try {
          adapter.send(event)
        } catch {
          /* adapter errors should not break feedback */
        }
      }
    }

    const sizeKb = screenshot ? Math.round((screenshot.length * 0.75) / 1024) : 0
    const catEmoji = FEEDBACK_CATEGORIES.find((c) => c.id === selectedCategory)?.emoji ?? ''
    console.log(
      `%c📝 Feedback sent%c ${catEmoji} ${text}%c ${screenshot ? `(+${sizeKb}KB screenshot)` : '(no screenshot)'}`,
      'color: #a6e3a1; font-weight: bold',
      'color: #cdd6f4',
      'color: #6c7086',
    )
    close()
  }

  document.getElementById('__sf_send')!.onclick = submit
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
}

// ── Event handlers (exported for use by init) ────────────────────────

export function handleCtrlClick(e: MouseEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
  const el = e.target as Element
  if (!el) return
  if (feedbackOverlay?.contains(el)) return
  e.preventDefault()
  e.stopPropagation()
  showFeedbackDialog(el, e.clientX, e.clientY)
}

export function initFeedback(config: ResolvedConfig): void {
  currentConfig = config
}
