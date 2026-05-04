/**
 * @microsoft/snapfeed — Core types
 *
 * Defines the telemetry event schema, configuration, and plugin interface.
 */

import {
  resolveSnapfeedTheme,
  type SnapfeedStylePreset,
  type SnapfeedTheme,
  type SnapfeedThemeConfig,
} from './ui-theme.js'

// ── Telemetry Event ──────────────────────────────────────────────────

export interface TelemetryEvent {
  session_id: string
  seq: number
  ts: string
  event_type: string
  page: string | null
  target: string | null
  detail: Record<string, unknown> | null
  screenshot?: string | null
}

// ── Feedback States ──────────────────────────────────────────────────

export type FeedbackStatusTone = 'success' | 'warning' | 'error'

export type FeedbackScreenshotState = 'pending' | 'ready' | 'unavailable'

export type FeedbackSubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'complete'; tone: FeedbackStatusTone; message: string; html?: boolean }

export interface FeedbackTrigger {
  element: Element
  x: number
  y: number
}

export interface FeedbackControllerSnapshot {
  x: number
  y: number
  text: string
  includeScreenshot: boolean
  includeContext: boolean
  screenshotState: FeedbackScreenshotState
  submitState: FeedbackSubmitState
  breadcrumb: string
  targetLabel: string
}

export interface FeedbackController {
  getSnapshot(): FeedbackControllerSnapshot
  subscribe(listener: (snapshot: FeedbackControllerSnapshot) => void): () => void
  setText(text: string): void
  setIncludeScreenshot(include: boolean): void
  setIncludeContext(include: boolean): void
  getPayloadPreview(): Record<string, unknown>
  getScreenshot(): string | null
  annotate(): Promise<boolean>
  submit(): Promise<FeedbackSubmitState>
  dispose(): void
}

export type FeedbackTriggerHandler = (
  controller: FeedbackController,
  trigger: FeedbackTrigger,
) => void

// ── User Identity ────────────────────────────────────────────────────

export interface SnapfeedUser {
  name?: string
  email?: string
  [key: string]: unknown
}

// ── Adapter System ───────────────────────────────────────────────────

/** Result returned by an adapter after sending feedback. */
export interface AdapterResult {
  ok: boolean
  error?: string
  /** Adapter-specific delivery ID (e.g. issue number, message ID). */
  deliveryId?: string
  /** URL to view the delivered feedback (e.g. GitHub issue link). */
  deliveryUrl?: string
}

/**
 * A feedback adapter delivers feedback events to an external system.
 * Multiple adapters can be chained — all receive the same payload.
 */
export interface FeedbackAdapter {
  name: string
  /** Human-friendly label shown in the UI (e.g. "GitHub"). Defaults to name. */
  displayName?: string
  send(event: TelemetryEvent): Promise<AdapterResult>
}

// ── Plugin System ────────────────────────────────────────────────────

/** Context returned by a plugin's element enrichment. */
export interface ElementEnrichment {
  componentName?: string
  fileName?: string
  lineNumber?: number
  columnNumber?: number
  /** Any extra framework-specific context the plugin wants to attach. */
  [key: string]: unknown
}

/**
 * A Snapfeed plugin provides framework-specific element enrichment.
 *
 * Plugins are registered via `registerPlugin()` and called on every
 * click event and feedback capture to enrich telemetry with context
 * like React component names, Angular component selectors, etc.
 */
export interface SnapfeedPlugin {
  /** Unique name for this plugin (e.g. "react", "angular"). */
  name: string

  /**
   * Enrich a DOM element with framework-specific context.
   * Called on click events and feedback captures.
   * Return null/undefined if the element has no framework context.
   */
  enrichElement(el: Element): ElementEnrichment | null | undefined

  /** Called once when the plugin is registered. */
  onInit?(): void

  /** Called when the plugin is unregistered. */
  onDestroy?(): void
}

// ── Configuration ────────────────────────────────────────────────────

export interface FeedbackConfig {
  /** Enable the Cmd+Click feedback flow. Default: true */
  enabled?: boolean
  /** Max screenshot width in pixels. Default: 1200 */
  screenshotMaxWidth?: number
  /** JPEG quality 0-1. Default: 0.6 */
  screenshotQuality?: number
  /** Background color for html2canvas. Default: '#1e1e2e' */
  backgroundColor?: string
  /** Enable annotation canvas for drawing on screenshots. Default: true */
  annotations?: boolean
  /** Allow users to exclude the screenshot for a single report. Default: true */
  allowScreenshotToggle?: boolean
  /** Allow users to exclude page context for a single report. Default: true */
  allowContextToggle?: boolean
  /** Attach screenshots by default. Default: true */
  defaultIncludeScreenshot?: boolean
  /** Attach page context by default. Default: true */
  defaultIncludeContext?: boolean
  /** Handle Cmd+Click with a custom UI instead of the built-in overlay. */
  onTrigger?: FeedbackTriggerHandler
}

export interface SnapfeedConfig {
  /** Endpoint URL for posting telemetry events. Default: '/api/telemetry/events' */
  endpoint?: string
  /** Flush interval in milliseconds. Default: 3000 */
  flushIntervalMs?: number
  /** Maximum events in the queue before oldest are dropped. Default: 500 */
  maxQueueSize?: number

  /** Track click events. Default: true */
  trackClicks?: boolean
  /** Track SPA navigation events. Default: true */
  trackNavigation?: boolean
  /** Track window errors and unhandled rejections. Default: true */
  trackErrors?: boolean
  /** Monkey-patch fetch() to track API errors. Default: true */
  trackApiErrors?: boolean
  /** Intercept console.error and include recent errors in feedback. Default: true */
  captureConsoleErrors?: boolean
  /** Max console errors to keep in buffer. Default: 20 */
  maxConsoleErrors?: number

  /** Feedback dialog configuration. */
  feedback?: FeedbackConfig

  /** Optional user identity included with all events. */
  user?: SnapfeedUser

  /** Theme preset or token overrides for the feedback and annotation UI. */
  theme?: SnapfeedThemeConfig

  /** Initial plugins to register. */
  plugins?: SnapfeedPlugin[]

  /** Feedback adapters — called on feedback events in addition to the telemetry endpoint. */
  adapters?: FeedbackAdapter[]

  /** Rage click detection. Default: enabled with threshold=3, windowMs=1000 */
  rageClick?: { enabled?: boolean; threshold?: number; windowMs?: number }

  /** Network request log. Default: enabled with maxSize=30 */
  networkLog?: { enabled?: boolean; maxSize?: number }

  /** Session replay (lightweight DOM/scroll/mouse recording). Default: disabled */
  sessionReplay?: { enabled?: boolean; windowSec?: number; maxEvents?: number }
}

/** Resolved config with all defaults applied. */
export interface ResolvedConfig {
  endpoint: string
  flushIntervalMs: number
  maxQueueSize: number
  trackClicks: boolean
  trackNavigation: boolean
  trackErrors: boolean
  trackApiErrors: boolean
  captureConsoleErrors: boolean
  maxConsoleErrors: number
  feedback: {
    enabled: boolean
    screenshotMaxWidth: number
    screenshotQuality: number
    backgroundColor: string
    annotations: boolean
    allowScreenshotToggle: boolean
    allowContextToggle: boolean
    defaultIncludeScreenshot: boolean
    defaultIncludeContext: boolean
    onTrigger: FeedbackTriggerHandler | null
  }
  user: SnapfeedUser | null
  theme: SnapfeedTheme
  themePreset: SnapfeedStylePreset | null
  adapters: FeedbackAdapter[]
  rageClick: { enabled: boolean; threshold: number; windowMs: number }
  networkLog: { enabled: boolean; maxSize: number }
  sessionReplay: { enabled: boolean; windowSec: number; maxEvents: number }
}

export function resolveConfig(config: SnapfeedConfig = {}): ResolvedConfig {
  const resolvedTheme = resolveSnapfeedTheme(config.theme)

  return {
    endpoint: config.endpoint ?? '/api/telemetry/events',
    flushIntervalMs: config.flushIntervalMs ?? 3000,
    maxQueueSize: config.maxQueueSize ?? 500,
    trackClicks: config.trackClicks ?? true,
    trackNavigation: config.trackNavigation ?? true,
    trackErrors: config.trackErrors ?? true,
    trackApiErrors: config.trackApiErrors ?? true,
    captureConsoleErrors: config.captureConsoleErrors ?? true,
    maxConsoleErrors: config.maxConsoleErrors ?? 20,
    feedback: {
      enabled: config.feedback?.enabled ?? true,
      screenshotMaxWidth: config.feedback?.screenshotMaxWidth ?? 1200,
      screenshotQuality: config.feedback?.screenshotQuality ?? 0.6,
      backgroundColor: config.feedback?.backgroundColor ?? '#1e1e2e',
      annotations: config.feedback?.annotations ?? true,
      allowScreenshotToggle: config.feedback?.allowScreenshotToggle ?? true,
      allowContextToggle: config.feedback?.allowContextToggle ?? true,
      defaultIncludeScreenshot: config.feedback?.defaultIncludeScreenshot ?? true,
      defaultIncludeContext: config.feedback?.defaultIncludeContext ?? true,
      onTrigger: config.feedback?.onTrigger ?? null,
    },
    user: config.user ?? null,
    theme: resolvedTheme.theme,
    themePreset: resolvedTheme.preset,
    adapters: config.adapters ?? [],
    rageClick: {
      enabled: config.rageClick?.enabled ?? true,
      threshold: config.rageClick?.threshold ?? 3,
      windowMs: config.rageClick?.windowMs ?? 1000,
    },
    networkLog: {
      enabled: config.networkLog?.enabled ?? true,
      maxSize: config.networkLog?.maxSize ?? 30,
    },
    sessionReplay: {
      enabled: config.sessionReplay?.enabled ?? false,
      windowSec: config.sessionReplay?.windowSec ?? 180,
      maxEvents: config.sessionReplay?.maxEvents ?? 5000,
    },
  }
}

export type {
  ResolvedSnapfeedTheme,
  SnapfeedStylePreset,
  SnapfeedTheme,
  SnapfeedThemeConfig,
} from './ui-theme.js'
