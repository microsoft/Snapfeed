/**
 * Feedback dialog — Cmd+Click visual feedback with screenshots.
 *
 * When the user Cmd+Clicks an element, this module:
 * 1. Gathers DOM context (data attributes, nearby images, dialog state)
 * 2. Captures a full-page screenshot with a click-position marker
 * 3. Shows a positioned dialog for the user to type feedback
 * 4. Pushes a 'feedback' telemetry event with context + screenshot
 */

import { showAnnotationCanvas } from "./annotation.js";
import { getConsoleErrors } from "./console-capture.js";
import { getLabel, getPath, getText } from "./helpers.js";
import { enrichElement } from "./plugins.js";
import { flush, getSessionId, push } from "./queue.js";
import { sanitizeDetail } from "./sanitize.js";
import type {
  FeedbackCategory,
  ResolvedConfig,
  TelemetryEvent,
} from "./types.js";
import { FEEDBACK_CATEGORIES } from "./types.js";
import { getSnapfeedTheme } from "./ui-theme.js";

let feedbackOverlay: HTMLDivElement | null = null;
let pendingScreenshot: Promise<string | null> | null = null;
let currentConfig: ResolvedConfig | null = null;
let overlayKeydownCleanup: (() => void) | null = null;
const OVERLAY_MARGIN = 12;
const OVERLAY_GAP = 12;

export function dismissFeedbackDialog(): void {
  overlayKeydownCleanup?.();
  overlayKeydownCleanup = null;
  feedbackOverlay?.remove();
  feedbackOverlay = null;
}

// html2canvas is a peer dependency — loaded lazily
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let html2canvasFn:
  | ((el: HTMLElement, opts?: unknown) => Promise<HTMLCanvasElement>)
  | null = null;

async function loadHtml2Canvas(): Promise<typeof html2canvasFn> {
  if (html2canvasFn) return html2canvasFn;
  try {
    // Dynamic import — works even if html2canvas is not installed
    const mod = await import("html2canvas");
    html2canvasFn = (mod.default ?? mod) as unknown as typeof html2canvasFn;
    return html2canvasFn;
  } catch {
    return null;
  }
}

// ── Context gathering ────────────────────────────────────────────────

export function gatherContext(el: Element): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    tag: el.tagName.toLowerCase(),
    path: getPath(el),
    text: getText(el),
    label: getLabel(el),
  };

  // Plugin enrichment (React component names, file paths, etc.)
  const enrichment = enrichElement(el);
  if (enrichment) {
    if (enrichment.componentName) ctx.component = enrichment.componentName;
    if (enrichment.fileName) ctx.source_file = enrichment.fileName;
    if (enrichment.lineNumber) ctx.source_line = enrichment.lineNumber;
    if (enrichment.columnNumber) ctx.source_column = enrichment.columnNumber;
    // Spread any extra plugin data
    for (const [key, value] of Object.entries(enrichment)) {
      if (
        !["componentName", "fileName", "lineNumber", "columnNumber"].includes(
          key,
        )
      ) {
        ctx[`plugin_${key}`] = value;
      }
    }
  }

  // Walk up to find data attributes
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    for (const attr of Array.from(cur.attributes)) {
      if (attr.name.startsWith("data-") && !ctx[attr.name]) {
        ctx[attr.name] = attr.value;
      }
    }
    if (cur.tagName === "IMG" && !ctx.img_src) {
      ctx.img_src = (cur as HTMLImageElement).src.replace(
        window.location.origin,
        "",
      );
    }
    cur = cur.parentElement;
  }

  // Capture any open dialog content
  const dialog = document.querySelector('[role="dialog"], .MuiDialog-root');
  if (dialog) {
    ctx.dialog_open = true;
    const title = dialog.querySelector('h2, h3, h4, h5, h6, [class*="title"]');
    if (title)
      ctx.dialog_title = (title as HTMLElement).innerText
        ?.trim()
        .substring(0, 100);
  }

  // Capture visible form/filter state (inputs, selects, checkboxes, sliders)
  const formState: Record<string, string> = {};
  const inputs = document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(
    'input:not([type="hidden"]):not([type="password"]), select, textarea, [role="combobox"], [role="slider"]',
  );
  for (const inp of inputs) {
    // Skip invisible elements
    if (!inp.offsetParent && inp.tagName !== "INPUT") continue;
    const label =
      inp.getAttribute("aria-label") ||
      inp
        .closest('[class*="FormControl"]')
        ?.querySelector("label")
        ?.textContent?.trim() ||
      inp.name ||
      inp.id ||
      "";
    if (!label) continue;
    let value = "";
    if (inp instanceof HTMLInputElement && inp.type === "checkbox") {
      value = inp.checked ? "true" : "false";
    } else if (inp.getAttribute("role") === "slider") {
      value =
        inp.getAttribute("aria-valuenow") ||
        inp.getAttribute("aria-valuetext") ||
        "";
    } else {
      value = inp.value || "";
    }
    if (value) formState[label.substring(0, 40)] = value.substring(0, 100);
  }
  if (Object.keys(formState).length > 0) ctx.form_state = formState;

  ctx.url = window.location.pathname + window.location.search;

  return ctx;
}

// ── Screenshot capture ───────────────────────────────────────────────

async function captureScreenshot(
  clickX: number,
  clickY: number,
): Promise<string | null> {
  if (!currentConfig) return null;
  const html2canvas = await loadHtml2Canvas();
  if (!html2canvas) return null;

  try {
    if (feedbackOverlay) feedbackOverlay.style.display = "none";

    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: true,
      scale: 1,
      logging: false,
      backgroundColor: currentConfig.feedback.backgroundColor,
      ignoreElements: (el: Element) => el === feedbackOverlay,
    } as unknown);

    if (feedbackOverlay) feedbackOverlay.style.display = "";

    // Scale down if wider than max
    const maxWidth = currentConfig.feedback.screenshotMaxWidth;
    let finalCanvas = canvas;
    if (canvas.width > maxWidth) {
      const ratio = maxWidth / canvas.width;
      const scaled = document.createElement("canvas");
      scaled.width = maxWidth;
      scaled.height = Math.round(canvas.height * ratio);
      const sctx = scaled.getContext("2d")!;
      sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
      finalCanvas = scaled;
    }

    // Draw click position marker (red crosshair)
    const scaleX = finalCanvas.width / window.innerWidth;
    const scaleY = finalCanvas.height / window.innerHeight;
    const mx = clickX * scaleX;
    const my = clickY * scaleY;
    const ctx = finalCanvas.getContext("2d")!;

    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mx, my, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff0000";
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mx - 30, my);
    ctx.lineTo(mx - 8, my);
    ctx.moveTo(mx + 8, my);
    ctx.lineTo(mx + 30, my);
    ctx.moveTo(mx, my - 30);
    ctx.lineTo(mx, my - 8);
    ctx.moveTo(mx, my + 8);
    ctx.lineTo(mx, my + 30);
    ctx.stroke();

    const quality = currentConfig.feedback.screenshotQuality;
    const dataUrl = finalCanvas.toDataURL("image/jpeg", quality);
    return dataUrl.split(",")[1] || null;
  } catch (err) {
    console.warn("[snapfeed] Screenshot capture failed:", err);
    if (feedbackOverlay) feedbackOverlay.style.display = "";
    return null;
  }
}

function getViewportBounds(): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const viewport = window.visualViewport;
  if (viewport) {
    return {
      left: viewport.offsetLeft,
      top: viewport.offsetTop,
      width: viewport.width,
      height: viewport.height,
    };
  }
  return {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function clampToViewport(
  value: number,
  size: number,
  viewportStart: number,
  viewportSize: number,
): number {
  const min = viewportStart + OVERLAY_MARGIN;
  const max = Math.max(
    min,
    viewportStart + viewportSize - size - OVERLAY_MARGIN,
  );
  return Math.max(min, Math.min(value, max));
}

function measureOverlaySize(overlay: HTMLDivElement): {
  width: number;
  height: number;
} {
  const rect = overlay.getBoundingClientRect();
  return {
    width: rect.width || overlay.offsetWidth || 360,
    height: rect.height || overlay.offsetHeight || 360,
  };
}

function positionOverlay(
  overlay: HTMLDivElement,
  anchorX: number,
  anchorY: number,
): void {
  const viewport = getViewportBounds();
  const availableWidth = Math.max(220, viewport.width - OVERLAY_MARGIN * 2);
  overlay.style.width = `${Math.min(420, availableWidth)}px`;
  overlay.style.maxWidth = `${Math.max(0, viewport.width - OVERLAY_MARGIN * 2)}px`;
  overlay.style.maxHeight = `${Math.max(0, viewport.height - OVERLAY_MARGIN * 2)}px`;

  const { width, height } = measureOverlaySize(overlay);
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;

  let left = anchorX + OVERLAY_GAP;
  if (left + width > viewportRight - OVERLAY_MARGIN) {
    left = anchorX - width - OVERLAY_GAP;
  }

  let top = anchorY + OVERLAY_GAP;
  if (top + height > viewportBottom - OVERLAY_MARGIN) {
    top = anchorY - height - OVERLAY_GAP;
  }

  overlay.style.left = `${clampToViewport(left, width, viewport.left, viewport.width)}px`;
  overlay.style.top = `${clampToViewport(top, height, viewport.top, viewport.height)}px`;
}

function setButtonEnabled(button: HTMLButtonElement, enabled: boolean): void {
  button.disabled = !enabled;
  button.style.opacity = enabled ? "1" : "0.55";
  button.style.cursor = enabled ? "pointer" : "not-allowed";
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

// ── Feedback dialog UI ───────────────────────────────────────────────

export function showFeedbackDialog(el: Element, x: number, y: number): void {
  dismissFeedbackDialog();

  if (!currentConfig) return;

  const context = gatherContext(el);
  const theme = getSnapfeedTheme();
  const feedbackConfig = currentConfig.feedback;
  const allowScreenshotToggle = feedbackConfig.allowScreenshotToggle;
  const allowContextToggle = feedbackConfig.allowContextToggle;
  const screenshotControlVisible =
    allowScreenshotToggle || feedbackConfig.annotations;
  const contextControlVisible = allowContextToggle;
  const viewport = getViewportBounds();
  const dialogWidth = Math.min(
    420,
    Math.max(220, viewport.width - OVERLAY_MARGIN * 2),
  );

  // Start capturing screenshot immediately (async, runs while user types)
  pendingScreenshot = captureScreenshot(x, y);

  // Build breadcrumb from page + context
  const crumbs: string[] = [];
  const page = window.location.pathname.split("/").filter(Boolean);
  crumbs.push(...page);
  if (context["data-feedback-context"])
    crumbs.push(context["data-feedback-context"] as string);
  if (context.dialog_open) crumbs.push("dialog");
  if (context["data-index"] != null)
    crumbs.push(`burst:${context["data-index"]}`);
  if (context.img_src) {
    const fname = (context.img_src as string).split("/").pop()?.split("?")[0];
    if (fname) crumbs.push(fname);
  }
  // Include component name from plugin enrichment
  if (context.component) crumbs.push(`<${context.component as string}>`);
  const breadcrumb = crumbs.join(" › ") || "page";

  let selectedCategory: FeedbackCategory = "bug";
  let includeScreenshot = feedbackConfig.defaultIncludeScreenshot;
  let includeContext = feedbackConfig.defaultIncludeContext;
  let screenshotState: "pending" | "ready" | "unavailable" = includeScreenshot
    ? "pending"
    : "ready";
  let screenshotData: string | null = null;
  let submitPhase: "idle" | "submitting" | "complete" = "idle";
  let completionTone: "success" | "warning" | "error" = "success";
  let completionMessage = "";
  let detailsExpanded = false;
  let payloadPreviewExpanded = false;
  let destroyed = false;

  feedbackOverlay = document.createElement("div");
  feedbackOverlay.dataset.snapfeedOverlay = "feedback-dialog";
  feedbackOverlay.style.cssText = `
    position: fixed; z-index: 99999;
    left: 0;
    top: 0;
    width: ${dialogWidth}px; overflow: auto;
    padding: 14px;
    background: ${theme.panelBackground}; color: ${theme.panelText}; border: 1px solid ${theme.panelBorder};
    border-radius: ${theme.panelRadius}; box-shadow: ${theme.panelShadow};
    font-family: ${theme.fontFamily}; font-size: 13px;
  `;
  // Stop ALL events from leaking out
  for (const evt of [
    "keydown",
    "keyup",
    "keypress",
    "mousedown",
    "mouseup",
    "click",
    "pointerdown",
    "pointerup",
    "focusin",
    "focusout",
  ]) {
    feedbackOverlay.addEventListener(evt, (e) => e.stopPropagation());
  }

  const targetLabel = (
    (context.label as string) ||
    (context.tag as string) ||
    ""
  ).substring(0, 60);

  // Build category chips HTML
  const chipsHtml = FEEDBACK_CATEGORIES.map(
    (c) =>
      `<button type="button" data-cat="${c.id}" style="padding:4px 10px; border-radius:12px; border:1px solid ${c.id === "bug" ? theme.accent : theme.panelBorder};
      background:${c.id === "bug" ? theme.accentSoft : "transparent"}; color:${theme.panelText}; cursor:pointer;
      font-size:12px; font-family:inherit; white-space:nowrap;">${c.emoji} ${c.label}</button>`,
  ).join("");

  feedbackOverlay.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px">
      <div>
        <div style="font-weight:600; color:${theme.accent}; margin-bottom:2px">📝 Feedback</div>
        <div style="color:${theme.mutedText}; font-size:11px">Describe the issue, idea, or question for this UI state.</div>
      </div>
      <button type="button" aria-label="Close feedback dialog" id="__sf_close" style="background:none; border:none; color:${theme.mutedText}; cursor:pointer; font-size:16px; line-height:1; padding:2px 4px">✕</button>
    </div>
    <div style="color:${theme.mutedText}; font-size:11px; margin-bottom:10px; line-height:1.45">
      <div style="margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeAttribute(breadcrumb)}">${breadcrumb}</div>
      <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
        title="${escapeAttribute(targetLabel)}">→ ${targetLabel}</div>
    </div>
    <div id="__sf_chips" style="display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap">${chipsHtml}</div>
    <textarea id="__sf_text" rows="5" placeholder="What's wrong / what should change?"
      style="width:100%; box-sizing:border-box; background:${theme.inputBackground}; color:${theme.inputText}; border:1px solid ${theme.inputBorder};
             border-radius:${theme.panelRadius}; padding:8px; font-size:14px; resize:vertical; font-family:inherit;
             outline:none; min-height:104px; line-height:1.45;"
    ></textarea>
    <div id="__sf_status" role="status" aria-live="polite" style="font-size:12px; color:${theme.mutedText}; line-height:1.45; margin-top:10px;"></div>
    <div id="__sf_details_shell" style="display:${screenshotControlVisible || contextControlVisible ? "flex" : "none"}; flex-direction:column; gap:8px; margin-top:10px; margin-bottom:10px;">
      <button type="button" id="__sf_details_toggle" aria-expanded="false" style="display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; min-height:34px; padding:7px 10px; border:1px solid ${theme.panelBorder}; border-radius:${theme.panelRadius}; background:transparent; color:${theme.panelText}; cursor:pointer; font-size:12px; font-family:inherit; text-align:left;">
        <span id="__sf_details_label">Details</span>
        <span id="__sf_details_chevron" style="color:${theme.mutedText}; font-size:11px;">Show</span>
      </button>
      <div id="__sf_controls" style="display:none; flex-direction:column; gap:8px; padding:10px; border:1px solid ${theme.panelBorder}; border-radius:${theme.panelRadius}; background:${theme.accentSoft};">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; color:${theme.panelText}; font-size:12px">
        <label id="__sf_screenshot_row" style="display:${screenshotControlVisible ? "inline-flex" : "none"}; gap:6px; align-items:center; cursor:pointer;">
          <input id="__sf_include_screenshot" type="checkbox" ${includeScreenshot ? "checked" : ""} />
          <span>Attach screenshot</span>
        </label>
        <label id="__sf_context_row" style="display:${contextControlVisible ? "inline-flex" : "none"}; gap:6px; align-items:center; cursor:pointer;">
          <input id="__sf_include_context" type="checkbox" ${includeContext ? "checked" : ""} />
          <span>Attach page context</span>
        </label>
      </div>
        <button type="button" id="__sf_payload_toggle" aria-expanded="false" style="display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; min-height:32px; padding:6px 10px; border:1px solid ${theme.panelBorder}; border-radius:${theme.panelRadius}; background:${theme.inputBackground}; color:${theme.panelText}; cursor:pointer; font-size:12px; font-family:inherit; text-align:left;">
          <span id="__sf_payload_label">Inspect payload JSON</span>
          <span id="__sf_payload_chevron" style="color:${theme.mutedText}; font-size:11px;">Show</span>
        </button>
        <pre id="__sf_payload_preview" style="display:none; margin:0; padding:10px; max-height:180px; overflow:auto; box-sizing:border-box; border:1px solid ${theme.panelBorder}; border-radius:${theme.panelRadius}; background:${theme.inputBackground}; color:${theme.inputText}; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-word;"></pre>
      </div>
    </div>
            <div style="display:flex; gap:10px; margin-top:8px; align-items:flex-end; justify-content:space-between; flex-wrap:wrap">
              <span style="color:${theme.mutedText}; font-size:10px; line-height:1.4; flex:1; min-width:180px; padding-bottom:2px;">Cmd/Ctrl+Enter to send · Esc to cancel</span>
              <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end; flex-wrap:wrap;">
          <button type="button" id="__sf_annotate" title="Annotate screenshot" style="display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:34px; padding:0 12px; background:${theme.accentSoft}; color:${theme.panelText}; border:1px solid ${theme.accent};
            border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px; font-weight:500;">✏️ <span>Annotate</span></button>
          <button type="button" id="__sf_cancel" style="display:inline-flex; align-items:center; justify-content:center; min-height:34px; padding:0 12px; background:none; color:${theme.mutedText}; border:1px solid ${theme.panelBorder};
            border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px;">Cancel</button>
          <button type="button" id="__sf_send" style="display:inline-flex; align-items:center; justify-content:center; min-height:34px; padding:0 14px; background:${theme.accent}; color:${theme.accentContrast}; border:none;
            border-radius:${theme.panelRadius}; cursor:pointer; font-weight:600; font-size:12px;">Send</button>
              </div>
    </div>
  `;
  document.body.appendChild(feedbackOverlay);

  const overlay = feedbackOverlay;
  const textarea = document.getElementById("__sf_text") as HTMLTextAreaElement;
  const chipsContainer = document.getElementById(
    "__sf_chips",
  ) as HTMLDivElement;
  const status = document.getElementById("__sf_status") as HTMLDivElement;
  const detailsToggle = document.getElementById(
    "__sf_details_toggle",
  ) as HTMLButtonElement | null;
  const detailsLabel = document.getElementById(
    "__sf_details_label",
  ) as HTMLSpanElement | null;
  const detailsChevron = document.getElementById(
    "__sf_details_chevron",
  ) as HTMLSpanElement | null;
  const detailsPanel = document.getElementById(
    "__sf_controls",
  ) as HTMLDivElement | null;
  const payloadToggle = document.getElementById(
    "__sf_payload_toggle",
  ) as HTMLButtonElement | null;
  const payloadLabel = document.getElementById(
    "__sf_payload_label",
  ) as HTMLSpanElement | null;
  const payloadChevron = document.getElementById(
    "__sf_payload_chevron",
  ) as HTMLSpanElement | null;
  const payloadPreview = document.getElementById(
    "__sf_payload_preview",
  ) as HTMLPreElement | null;
  const sendButton = document.getElementById("__sf_send") as HTMLButtonElement;
  const cancelButton = document.getElementById(
    "__sf_cancel",
  ) as HTMLButtonElement;
  const closeButton = document.getElementById(
    "__sf_close",
  ) as HTMLButtonElement;
  const annotateButton = document.getElementById(
    "__sf_annotate",
  ) as HTMLButtonElement;
  const screenshotCheckbox = document.getElementById(
    "__sf_include_screenshot",
  ) as HTMLInputElement | null;
  const contextCheckbox = document.getElementById(
    "__sf_include_context",
  ) as HTMLInputElement | null;
  let positionRaf = 0;

  const toneStyles: Record<
    "success" | "warning" | "error",
    { background: string; color: string }
  > = {
    success: { background: theme.accentSoft, color: theme.panelText },
    warning: { background: "rgba(250, 204, 21, 0.12)", color: theme.panelText },
    error: { background: "rgba(248, 113, 113, 0.14)", color: theme.panelText },
  };

  const isActiveOverlay = () => feedbackOverlay === overlay && !destroyed;

  const schedulePosition = () => {
    if (!isActiveOverlay()) return;
    if (positionRaf) cancelAnimationFrame(positionRaf);
    positionRaf = requestAnimationFrame(() => {
      positionRaf = 0;
      if (!isActiveOverlay()) return;
      positionOverlay(overlay, x, y);
    });
  };

  const getDetailsSummary = (): string => {
    const parts: string[] = [];
    if (screenshotControlVisible) {
      parts.push(includeScreenshot ? "Screenshot on" : "Screenshot off");
    }
    if (contextControlVisible) {
      parts.push(includeContext ? "Context on" : "Context off");
    }
    return parts.length > 0 ? `Details · ${parts.join(" · ")}` : "Details";
  };

  const getBaseDetail = (): Record<string, unknown> => {
    const detail: Record<string, unknown> = {
      category: selectedCategory,
      screenshot_included: includeScreenshot,
      page_context_included: includeContext,
    };
    if (currentConfig?.user) detail.user = currentConfig.user;
    return detail;
  };

  const getSanitizedDetail = (): Record<string, unknown> => {
    const detail = getBaseDetail();
    if (includeContext) {
      Object.assign(detail, context);
      const consoleErrors = getConsoleErrors();
      if (consoleErrors.length > 0) detail.console_errors = consoleErrors;
    }
    return sanitizeDetail(detail);
  };

  const getPayloadPreview = (): Record<string, unknown> => ({
    event_type: "feedback",
    page: window.location.pathname,
    target: textarea.value.trim() || null,
    detail: getSanitizedDetail(),
    screenshot: includeScreenshot
      ? screenshotState === "ready"
        ? "[base64 screenshot attached]"
        : screenshotState === "pending"
          ? "[screenshot capture pending]"
          : null
      : null,
  });

  const updateStatus = (
    message: string,
    tone?: "success" | "warning" | "error",
  ) => {
    status.textContent = message;
    status.style.padding = message ? "8px 10px" : "0";
    status.style.borderRadius = theme.panelRadius;
    if (tone) {
      status.style.background = toneStyles[tone].background;
      status.style.color = toneStyles[tone].color;
    } else {
      status.style.background = "transparent";
      status.style.color = theme.mutedText;
    }
  };

  const updateUi = () => {
    const isSubmitting = submitPhase === "submitting";
    const isComplete = submitPhase === "complete";
    const hasText = textarea.value.trim().length > 0;

    textarea.disabled = isSubmitting || isComplete;
    chipsContainer
      .querySelectorAll<HTMLButtonElement>("button[data-cat]")
      .forEach((button) => {
        const isActive = button.dataset.cat === selectedCategory;
        button.disabled = isSubmitting || isComplete;
        button.style.border = `1px solid ${isActive ? theme.accent : theme.panelBorder}`;
        button.style.background = isActive ? theme.accentSoft : "transparent";
        button.style.opacity = isSubmitting || isComplete ? "0.65" : "1";
        button.style.cursor =
          isSubmitting || isComplete ? "not-allowed" : "pointer";
      });

    if (screenshotCheckbox) {
      screenshotCheckbox.checked = includeScreenshot;
      screenshotCheckbox.disabled =
        isSubmitting ||
        isComplete ||
        screenshotState === "unavailable" ||
        !allowScreenshotToggle;
    }
    if (contextCheckbox) {
      contextCheckbox.checked = includeContext;
      contextCheckbox.disabled =
        isSubmitting || isComplete || !allowContextToggle;
    }

    if (detailsToggle && detailsLabel && detailsChevron && detailsPanel) {
      detailsToggle.disabled = isSubmitting;
      detailsToggle.style.opacity = isSubmitting ? "0.65" : "1";
      detailsToggle.style.cursor = isSubmitting ? "not-allowed" : "pointer";
      detailsToggle.setAttribute(
        "aria-expanded",
        detailsExpanded ? "true" : "false",
      );
      detailsLabel.textContent = getDetailsSummary();
      detailsChevron.textContent = detailsExpanded ? "Hide" : "Show";
      detailsPanel.style.display = detailsExpanded ? "flex" : "none";
    }

    if (payloadToggle && payloadLabel && payloadChevron && payloadPreview) {
      payloadToggle.disabled = isSubmitting;
      payloadToggle.style.opacity = isSubmitting ? "0.65" : "1";
      payloadToggle.style.cursor = isSubmitting ? "not-allowed" : "pointer";
      payloadToggle.setAttribute(
        "aria-expanded",
        payloadPreviewExpanded ? "true" : "false",
      );
      payloadLabel.textContent = "Inspect payload JSON";
      payloadChevron.textContent = payloadPreviewExpanded ? "Hide" : "Show";
      payloadPreview.style.display = payloadPreviewExpanded ? "block" : "none";
      if (payloadPreviewExpanded) {
        payloadPreview.textContent = JSON.stringify(
          getPayloadPreview(),
          null,
          2,
        );
      }
    }

    setButtonEnabled(
      annotateButton,
      Boolean(
        feedbackConfig.annotations &&
        includeScreenshot &&
        screenshotState === "ready" &&
        !isSubmitting &&
        !isComplete,
      ),
    );
    setButtonEnabled(cancelButton, !isSubmitting);
    setButtonEnabled(closeButton, !isSubmitting);

    if (isComplete) {
      sendButton.textContent = "Close";
      setButtonEnabled(sendButton, true);
      cancelButton.style.display = "none";
      updateStatus(completionMessage, completionTone);
      schedulePosition();
      return;
    }

    cancelButton.style.display = "";
    sendButton.textContent = isSubmitting
      ? includeScreenshot && screenshotState === "pending"
        ? "Preparing..."
        : "Sending..."
      : "Send";
    setButtonEnabled(sendButton, !isSubmitting && hasText);

    if (isSubmitting) {
      updateStatus(
        includeScreenshot && screenshotState === "pending"
          ? "Finishing screenshot capture before sending. You can keep the dialog open."
          : "Sending feedback...",
      );
      schedulePosition();
      return;
    }

    if (!includeScreenshot) {
      updateStatus("Screenshot will be skipped for this report.");
      schedulePosition();
      return;
    }

    if (screenshotState === "pending") {
      updateStatus(
        "Preparing screenshot in the background. You can keep typing while it finishes.",
      );
      schedulePosition();
      return;
    }

    if (screenshotState === "ready") {
      updateStatus(
        feedbackConfig.annotations
          ? "Screenshot attached. You can annotate it before sending if needed."
          : "Screenshot attached and ready to send.",
      );
      schedulePosition();
      return;
    }

    updateStatus(
      "Screenshot capture is unavailable on this page. Text feedback still works.",
    );
    schedulePosition();
  };

  // Category chip click handling
  chipsContainer.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(
      "button[data-cat]",
    ) as HTMLButtonElement | null;
    if (!btn || submitPhase !== "idle") return;
    selectedCategory = btn.dataset.cat as FeedbackCategory;
    updateUi();
  });

  const focusTextarea = () => {
    if (!isActiveOverlay() || submitPhase !== "idle") return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };
  requestAnimationFrame(() => {
    focusTextarea();
    if (document.activeElement !== textarea) {
      setTimeout(focusTextarea, 0);
    }
  });
  textarea.addEventListener("input", updateUi);

  const close = () => {
    if (submitPhase === "submitting") return;
    dismissFeedbackDialog();
  };

  cancelButton.onclick = close;
  closeButton.onclick = close;

  screenshotCheckbox?.addEventListener("change", () => {
    if (submitPhase !== "idle") return;
    includeScreenshot = screenshotCheckbox.checked;
    if (!includeScreenshot) detailsExpanded = true;
    updateUi();
  });
  contextCheckbox?.addEventListener("change", () => {
    if (submitPhase !== "idle") return;
    includeContext = contextCheckbox.checked;
    if (!includeContext) detailsExpanded = true;
    updateUi();
  });

  detailsToggle?.addEventListener("click", () => {
    if (submitPhase !== "idle") return;
    detailsExpanded = !detailsExpanded;
    updateUi();
  });

  payloadToggle?.addEventListener("click", () => {
    if (submitPhase !== "idle") return;
    payloadPreviewExpanded = !payloadPreviewExpanded;
    detailsExpanded = true;
    updateUi();
  });

  // Annotate button — opens annotation canvas on the screenshot
  annotateButton.onclick = async () => {
    if (
      !feedbackConfig.annotations ||
      submitPhase !== "idle" ||
      !includeScreenshot
    )
      return;
    const screenshot = await pendingScreenshot;
    if (!isActiveOverlay()) return;
    if (!screenshot) {
      screenshotState = "unavailable";
      includeScreenshot = false;
      updateUi();
      return;
    }
    screenshotData = screenshot;
    screenshotState = "ready";
    overlay.style.display = "none";
    const annotated = await showAnnotationCanvas(
      screenshot,
      feedbackConfig.screenshotQuality,
    );
    if (!isActiveOverlay()) return;
    overlay.style.display = "";
    if (annotated) {
      screenshotData = annotated;
      pendingScreenshot = Promise.resolve(annotated);
      screenshotState = "ready";
    }
    focusTextarea();
    updateUi();
  };

  const submit = async () => {
    if (!isActiveOverlay()) return;
    if (submitPhase === "complete") {
      close();
      return;
    }
    if (submitPhase === "submitting") return;

    const text = textarea.value.trim();
    if (!text) {
      focusTextarea();
      updateUi();
      return;
    }

    submitPhase = "submitting";
    updateUi();

    let screenshot: string | null = null;
    if (includeScreenshot) {
      screenshot = screenshotData ?? (await pendingScreenshot);
      if (!isActiveOverlay()) return;
      screenshotData = screenshot;
      if (!screenshot) {
        screenshotState = "unavailable";
        includeScreenshot = false;
      } else {
        screenshotState = "ready";
      }
      updateUi();
    }

    const sanitizedContext = getSanitizedDetail();
    push(
      "feedback",
      text,
      sanitizedContext,
      includeScreenshot ? screenshot : null,
    );

    const flushOk = await flush();
    if (!isActiveOverlay()) return;

    const adapters = currentConfig?.adapters ?? [];

    const adapterEvent: TelemetryEvent = {
      session_id: getSessionId(),
      seq: -1,
      ts: new Date().toISOString(),
      event_type: "feedback",
      page: window.location.pathname,
      target: text,
      detail: sanitizedContext,
      screenshot: includeScreenshot ? screenshot : null,
    };

    const adapterSettled = await Promise.allSettled(
      adapters.map(async (adapter) => ({
        name: adapter.name,
        result: await adapter.send(adapterEvent),
      })),
    );
    if (!isActiveOverlay()) return;

    const adapterFailures = adapterSettled.flatMap((entry) => {
      if (entry.status === "rejected") return ["adapter"];
      return entry.value.result.ok ? [] : [entry.value.name];
    });

    submitPhase = "complete";
    if (!flushOk || adapterFailures.length > 0) {
      completionTone = "warning";
      completionMessage = [
        flushOk
          ? "Feedback saved and sent from this page."
          : "Feedback saved locally. Server delivery will retry automatically.",
        adapterFailures.length > 0
          ? `Adapter delivery failed: ${adapterFailures.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
    } else {
      completionTone = "success";
      completionMessage = includeScreenshot
        ? "Feedback sent with the current screenshot attached."
        : "Feedback sent without a screenshot.";
    }

    const sizeKb = screenshot
      ? Math.round((screenshot.length * 0.75) / 1024)
      : 0;
    const catEmoji =
      FEEDBACK_CATEGORIES.find((c) => c.id === selectedCategory)?.emoji ?? "";
    console.log(
      `%c📝 Feedback sent%c ${catEmoji} ${text}%c ${screenshot ? `(+${sizeKb}KB screenshot)` : "(no screenshot)"}`,
      "color: #a6e3a1; font-weight: bold",
      "color: #cdd6f4",
      "color: #6c7086",
    );
    updateUi();
  };

  sendButton.onclick = () => {
    void submit();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isActiveOverlay()) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const onViewportChange = () => {
    schedulePosition();
  };
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("resize", onViewportChange);
  window.visualViewport?.addEventListener("scroll", onViewportChange);
  overlayKeydownCleanup = () => {
    destroyed = true;
    if (positionRaf) cancelAnimationFrame(positionRaf);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("scroll", onViewportChange);
  };

  void pendingScreenshot.then((result) => {
    if (!isActiveOverlay()) return;
    screenshotData = result;
    if (!result) {
      screenshotState = "unavailable";
      includeScreenshot = false;
    } else {
      screenshotState = "ready";
    }
    updateUi();
  });

  updateUi();
  schedulePosition();
}

// ── Event handlers (exported for use by init) ────────────────────────

export function handleCtrlClick(e: MouseEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const el = e.target as Element;
  if (!el) return;
  if (feedbackOverlay?.contains(el)) return;
  e.preventDefault();
  e.stopPropagation();
  showFeedbackDialog(el, e.clientX, e.clientY);
}

export function initFeedback(config: ResolvedConfig): void {
  currentConfig = config;
}
