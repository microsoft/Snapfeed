/**
 * @microsoft/snapfeed
 *
 * UI feedback & telemetry for agentic workflows.
 * Captures clicks, errors, navigation, and visual feedback
 * with framework-agnostic plugin support.
 *
 * Usage:
 *   import { initSnapfeed } from '@microsoft/snapfeed'
 *   initSnapfeed({ endpoint: '/api/telemetry/events' })
 *
 * Plugin support:
 *   import { registerPlugin } from '@microsoft/snapfeed'
 *   registerPlugin({ name: 'react', enrichElement: (el) => ({ componentName: '...' }) })
 */

import type { SnapfeedConfig, SnapfeedPlugin, ElementEnrichment } from './types.js'
import { resolveConfig } from './types.js'
import { getLabel, getPath } from './helpers.js'
import { enrichElement } from './plugins.js'
import { getSessionId, push, flush, startFlushing, stopFlushing, getQueue } from './queue.js'
import { handleCtrlClick, gatherContext, initFeedback } from './feedback.js'
import { registerPlugin, unregisterPlugin, getPluginNames, clearPlugins } from './plugins.js'
import { startCapturing, stopCapturing } from './console-capture.js'
import { sanitizeDetail } from './sanitize.js'

// Re-export public API
export type {
  SnapfeedConfig, SnapfeedPlugin, ElementEnrichment, TelemetryEvent,
  FeedbackConfig, FeedbackCategory, SnapfeedUser,
  FeedbackAdapter, AdapterResult,
} from './types.js'
export { FEEDBACK_CATEGORIES } from './types.js'
export { registerPlugin, unregisterPlugin, getPluginNames } from './plugins.js'
export { getSessionId, push, flush } from './queue.js'
export { gatherContext } from './feedback.js'
export { getLabel, getPath, getText, describeElement } from './helpers.js'
export { enrichElement } from './plugins.js'
export { consoleAdapter, webhookAdapter } from './adapters.js'
export { sanitize, sanitizeDetail } from './sanitize.js'
export { getConsoleErrors } from './console-capture.js'

let initialized = false
let originalFetch: typeof fetch | null = null
let cleanupFns: (() => void)[] = []

// ── Event handlers ───────────────────────────────────────────────────

function handleClick(e: MouseEvent): void {
  if (e.ctrlKey || e.metaKey) return
  const el = e.target as Element
  if (!el) return
  const label = getLabel(el)

  const detail: Record<string, unknown> = {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    path: getPath(el),
    x: Math.round(e.clientX),
    y: Math.round(e.clientY),
  }

  // Plugin enrichment
  const pluginCtx = enrichElement(el)
  if (pluginCtx) {
    if (pluginCtx.componentName) detail['component'] = pluginCtx.componentName
    if (pluginCtx.fileName) detail['source_file'] = pluginCtx.fileName
    if (pluginCtx.lineNumber) detail['source_line'] = pluginCtx.lineNumber
  }

  // Sanitize before sending
  push('click', label, sanitizeDetail(detail))

  console.log(
    `%c🖱 click%c ${label}%c${pluginCtx?.componentName ? ` <${pluginCtx.componentName}>` : ''} @ (${Math.round(e.clientX)},${Math.round(e.clientY)})`,
    'color: #58a6ff; font-weight: bold',
    'color: #c9d1d9',
    'color: #8b949e',
  )
}

function handleError(e: ErrorEvent): void {
  push('error', 'window.onerror', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error?.stack?.substring(0, 500),
  })
  flush()
}

function handleUnhandledRejection(e: PromiseRejectionEvent): void {
  const reason = e.reason
  push('error', 'unhandled_rejection', {
    message: String(reason?.message ?? reason),
    stack: reason?.stack?.substring(0, 500),
  })
  flush()
}

function handleNavigation(): void {
  push('navigation', window.location.pathname, {
    hash: window.location.hash,
    search: window.location.search,
  })
}

function patchFetch(endpoint: string): void {
  originalFetch = window.fetch
  const origFetch = originalFetch
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
    try {
      const res = await origFetch.apply(this, args)
      if (!res.ok && !url.includes(endpoint)) {
        push('api_error', url, {
          status: res.status,
          statusText: res.statusText,
          method: (args[1] as RequestInit)?.method ?? 'GET',
        })
      }
      return res
    } catch (err) {
      if (!url.includes(endpoint)) {
        push('network_error', url, {
          message: String((err as Error)?.message ?? err),
          method: (args[1] as RequestInit)?.method ?? 'GET',
        })
      }
      throw err
    }
  }
}

function unpatchFetch(): void {
  if (originalFetch) {
    window.fetch = originalFetch
    originalFetch = null
  }
}

// ── Init / Destroy ───────────────────────────────────────────────────

/**
 * Initialize Snapfeed telemetry.
 *
 * Call once at app startup (e.g. in main.tsx before ReactDOM.render).
 * Returns a teardown function that removes all listeners.
 */
export function initSnapfeed(config: SnapfeedConfig = {}): () => void {
  if (initialized) {
    console.warn('[snapfeed] Already initialized. Call the teardown function first.')
    return () => {}
  }

  const resolved = resolveConfig(config)

  // Register initial plugins
  if (config.plugins) {
    for (const plugin of config.plugins) {
      registerPlugin(plugin)
    }
  }

  // Start event queue
  startFlushing(resolved)

  // Initialize feedback module
  initFeedback(resolved)

  // Start console error capture
  if (resolved.captureConsoleErrors) {
    startCapturing(resolved.maxConsoleErrors)
    cleanupFns.push(stopCapturing)
  }

  // Register event listeners
  if (resolved.feedback.enabled) {
    document.addEventListener('click', handleCtrlClick, { capture: true })
    cleanupFns.push(() => document.removeEventListener('click', handleCtrlClick, { capture: true }))
  }

  if (resolved.trackClicks) {
    document.addEventListener('click', handleClick, { capture: true })
    cleanupFns.push(() => document.removeEventListener('click', handleClick, { capture: true }))
  }

  if (resolved.trackErrors) {
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    cleanupFns.push(() => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    })
  }

  if (resolved.trackNavigation) {
    window.addEventListener('popstate', handleNavigation)
    const origPush = history.pushState.bind(history)
    const origReplace = history.replaceState.bind(history)
    history.pushState = function (...args) {
      origPush(...args)
      handleNavigation()
    }
    history.replaceState = function (...args) {
      origReplace(...args)
      handleNavigation()
    }
    cleanupFns.push(() => {
      window.removeEventListener('popstate', handleNavigation)
      history.pushState = origPush
      history.replaceState = origReplace
    })
  }

  if (resolved.trackApiErrors) {
    patchFetch(resolved.endpoint)
    cleanupFns.push(unpatchFetch)
  }

  // Flush on page unload
  const onUnload = () => { flush(); stopFlushing() }
  window.addEventListener('beforeunload', onUnload)
  cleanupFns.push(() => window.removeEventListener('beforeunload', onUnload))

  // Record session start
  push('session_start', null, {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    url: window.location.href,
    plugins: getPluginNames(),
    user: resolved.user,
  })

  // Expose for console debugging
  ;(window as unknown as Record<string, unknown>).__snapfeed = {
    sessionId: getSessionId(),
    queue: getQueue(),
    flush,
    plugins: getPluginNames,
  }

  initialized = true
  console.log(
    `%c📊 Snapfeed active%c session=${getSessionId()}${getPluginNames().length ? ` plugins=[${getPluginNames().join(',')}]` : ''}`,
    'color: #58a6ff; font-weight: bold',
    'color: #8b949e',
  )

  // Return teardown function
  return () => {
    for (const fn of cleanupFns) fn()
    cleanupFns = []
    stopFlushing()
    clearPlugins()
    delete (window as unknown as Record<string, unknown>).__snapfeed
    initialized = false
  }
}
