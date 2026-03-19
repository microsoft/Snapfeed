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
import type { FeedbackCategory, ResolvedConfig } from "./types.js";
import { FEEDBACK_CATEGORIES } from "./types.js";
import { getSnapfeedTheme } from "./ui-theme.js";

let feedbackOverlay: HTMLDivElement | null = null;
let pendingScreenshot: Promise<string | null> | null = null;
let currentConfig: ResolvedConfig | null = null;

interface ShowFeedbackDialogOptions {
  initialMessage?: string;
  initialCategory?: FeedbackCategory;
  initialHasAnnotatedScreenshot?: boolean;
  initialBaseScreenshotPromise?: Promise<string | null>;
  initialExpanded?: boolean;
  screenshotPromise?: Promise<string | null>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getPlaceholder(category: FeedbackCategory): string {
  switch (category) {
    case "bug":
      return "What is broken? What did you expect instead?";
    case "idea":
      return "What would make this better?";
    case "question":
      return "What feels unclear or confusing?";
    case "praise":
      return "What is working especially well?";
    case "other":
      return "What should the next person reviewing this know?";
  }
}

function getCategoryHint(category: FeedbackCategory): string {
  switch (category) {
    case "bug":
      return "Focus on what broke, what you expected, and whether it blocks the task.";
    case "idea":
      return "Describe the improvement and why it would make the experience stronger.";
    case "question":
      return "Call out what feels unclear, surprising, or missing from the current flow.";
    case "praise":
      return "Capture what is working well so the team knows what to preserve.";
    case "other":
      return "Use this for context that does not fit the other categories cleanly.";
  }
}

function buildContextChips(context: Record<string, unknown>): string[] {
  const chips: string[] = [];
  const path = window.location.pathname || "/";
  chips.push(`Page ${path}`);

  if (context["data-feedback-context"]) {
    chips.push(`Context ${String(context["data-feedback-context"])}`);
  }
  if (context.component) {
    chips.push(`Component ${String(context.component)}`);
  }
  if (context.dialog_open) {
    chips.push("Dialog open");
  }
  if (context["data-index"] != null) {
    chips.push(`Burst ${String(context["data-index"])}`);
  }
  if (context.img_src) {
    const fileName = String(context.img_src).split("/").pop()?.split("?")[0];
    if (fileName) chips.push(`Asset ${fileName}`);
  }

  return chips.slice(0, 4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function positionFeedbackOverlay(
  overlay: HTMLDivElement,
  anchorX: number,
  anchorY: number,
): void {
  const margin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxHeight = Math.max(220, viewportHeight - margin * 2);

  overlay.style.maxHeight = `${maxHeight}px`;
  overlay.style.overflowY = "auto";
  overlay.style.overflowX = "hidden";
  overlay.style.overscrollBehavior = "contain";
  overlay.style.scrollbarGutter = "stable";
  overlay.style.setProperty("-webkit-overflow-scrolling", "touch");

  const rect = overlay.getBoundingClientRect();
  const availableBelow = viewportHeight - anchorY - margin;
  const availableAbove = anchorY - margin;
  const preferAbove =
    rect.height > availableBelow && availableAbove > availableBelow;

  const top = preferAbove ? anchorY - rect.height : anchorY;
  const left = anchorX;

  overlay.style.left = `${clamp(left, margin, Math.max(margin, viewportWidth - rect.width - margin))}px`;
  overlay.style.top = `${clamp(top, margin, Math.max(margin, viewportHeight - rect.height - margin))}px`;
}

export function dismissFeedbackDialog(): void {
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

// ── Feedback dialog UI ───────────────────────────────────────────────

export function showFeedbackDialog(
  el: Element,
  x: number,
  y: number,
  options: ShowFeedbackDialogOptions = {},
): void {
  dismissFeedbackDialog();

  const context = gatherContext(el);
  const theme = getSnapfeedTheme();

  // Start capturing screenshot immediately (async, runs while user types)
  pendingScreenshot = options.screenshotPromise ?? captureScreenshot(x, y);

  let selectedCategory: FeedbackCategory = options.initialCategory ?? "bug";
  let hasAnnotatedScreenshot = options.initialHasAnnotatedScreenshot ?? false;
  let baseScreenshot: string | null | undefined;
  let resolvedScreenshot: string | null | undefined;
  let screenshotStatus: "capturing" | "ready" | "unavailable" = "capturing";
  let sending = false;
  let isExpanded = options.initialExpanded ?? false;
  const isCompact = () => window.innerWidth < 540;

  const contextChips = buildContextChips(context);
  const targetLabel = (
    (context.label as string) ||
    (context.tag as string) ||
    "Selected element"
  ).trim();
  const targetPreview = targetLabel.substring(0, 120);
  const overlayWidth = Math.min(420, Math.max(280, window.innerWidth - 24));

  feedbackOverlay = document.createElement("div");
  feedbackOverlay.dataset.snapfeedOverlay = "feedback-dialog";
  feedbackOverlay.style.cssText = `
    position: fixed; z-index: 99999;
    left: 12px;
    top: 12px;
    width: ${overlayWidth}px; max-width: calc(100vw - 24px); padding: 14px;
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

  // Build category chips HTML
  const chipsHtml = FEEDBACK_CATEGORIES.map(
    (c) =>
      `<button data-cat="${c.id}" type="button" style="padding:6px 10px; border-radius:999px; border:1px solid ${c.id === "bug" ? theme.accent : theme.panelBorder};
      background:${c.id === "bug" ? theme.accentSoft : "transparent"}; color:${theme.panelText}; cursor:pointer;
      font-size:12px; font-family:inherit; white-space:nowrap; transition:border-color 120ms ease, background 120ms ease, transform 120ms ease;">${c.emoji} ${c.label}</button>`,
  ).join("");

  const contextHtml = contextChips
    .map(
      (chip) =>
        `<span style="padding:4px 8px; border-radius:999px; border:1px solid ${theme.panelBorder}; background:${theme.accentSoft}; color:${theme.panelText}; font-size:11px; line-height:1.2; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(chip)}</span>`,
    )
    .join("");

  feedbackOverlay.innerHTML = `
    <div style="display:grid; gap:12px; min-height:0;">
      <div id="__sf_body" style="display:grid; gap:12px; min-height:0;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
        <div style="display:grid; gap:4px; min-width:0;">
          <span style="font-size:12px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.accent}; font-weight:700;">Feedback</span>
          <div style="font-size:18px; line-height:1.2; font-weight:700; color:${theme.panelText};">Capture what changed and why</div>
          <div style="color:${theme.mutedText}; font-size:12px; line-height:1.45;">Fast report, full context, optional screenshot markup.</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
          <button id="__sf_toggle_details" type="button" style="padding:6px 10px; border-radius:${theme.panelRadius}; border:1px solid ${theme.panelBorder}; background:transparent; color:${theme.panelText}; cursor:pointer; font-size:12px; font-family:inherit;">More details</button>
          <button id="__sf_close" type="button" aria-label="Close feedback dialog" style="width:28px; height:28px; border-radius:999px; border:1px solid ${theme.panelBorder}; background:transparent; color:${theme.mutedText}; cursor:pointer; font-size:12px;">✕</button>
        </div>
      </div>
      <div id="__sf_quick_summary" style="display:grid; gap:4px; padding:10px 12px; border-radius:${theme.panelRadius}; border:1px solid ${theme.panelBorder}; background:${theme.inputBackground};">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.12em; color:${theme.mutedText};">Reporting on</div>
        <div style="font-size:13px; line-height:1.45; color:${theme.panelText}; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;" title="${escapeHtml(targetLabel)}">${escapeHtml(targetPreview)}</div>
      </div>
      <div id="__sf_details_panel" style="display:grid; gap:12px;">
      <div style="display:grid; gap:8px;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; min-width:0;">${contextHtml}</div>
        <div style="padding:10px 12px; border-radius:${theme.panelRadius}; border:1px solid ${theme.panelBorder}; background:${theme.inputBackground}; display:grid; gap:4px;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.12em; color:${theme.mutedText};">Target</div>
          <div style="font-size:13px; line-height:1.45; color:${theme.panelText}; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;" title="${escapeHtml(targetLabel)}">${escapeHtml(targetPreview)}</div>
        </div>
      </div>
      </div>
      <div id="__sf_chips" style="display:flex; gap:6px; flex-wrap:wrap">${chipsHtml}</div>
      <div id="__sf_category_hint" style="color:${theme.mutedText}; font-size:12px; line-height:1.45; margin-top:-2px;"></div>
      <div style="display:grid; gap:8px;">
        <div id="__sf_message_meta" style="display:flex; justify-content:space-between; gap:12px; align-items:flex-end;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.12em; color:${theme.mutedText};">Message</div>
          <div id="__sf_message_helper" style="color:${theme.mutedText}; font-size:11px; line-height:1.4; white-space:nowrap;">Be specific enough that someone else can reproduce it.</div>
        </div>
        <textarea id="__sf_text" rows="4" placeholder="${escapeHtml(getPlaceholder(selectedCategory))}"
          style="width:100%; box-sizing:border-box; background:${theme.inputBackground}; color:${theme.inputText}; border:1px solid ${theme.inputBorder};
                 border-radius:${theme.panelRadius}; padding:10px 12px; font-size:14px; resize:vertical; font-family:inherit;
                 outline:none; min-height:104px; line-height:1.5; transition:border-color 120ms ease, box-shadow 120ms ease;"
        >${escapeHtml(options.initialMessage ?? "")}</textarea>
        <div id="__sf_validation_row" style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
          <div id="__sf_validation" style="color:${theme.mutedText}; font-size:11px; line-height:1.4; min-height:16px;"></div>
          <div id="__sf_shortcuts_hint" style="color:${theme.mutedText}; font-size:11px; line-height:1.4; white-space:nowrap;">⌘+Enter send · Esc cancel</div>
        </div>
      </div>
      <div id="__sf_info_panel" style="display:grid; gap:6px; padding:10px 12px; border-radius:${theme.panelRadius}; border:1px solid ${theme.panelBorder}; background:${theme.accentSoft};">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.12em; color:${theme.mutedText};">Included with this report</div>
        <div id="__sf_info_text" style="color:${theme.panelText}; font-size:12px; line-height:1.5;">Message, page context, selected element metadata, recent console errors, and screenshot data when available.</div>
        <div id="__sf_payload_summary" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
        <details id="__sf_payload_details" style="font-size:12px;">
          <summary style="cursor:pointer; color:${theme.panelText}; font-weight:600;">Inspect payload preview</summary>
          <div style="display:grid; gap:8px; margin-top:8px;">
            <div style="color:${theme.mutedText}; font-size:11px; line-height:1.45;">Session id is final. Sequence and timestamp are added when the event is queued.</div>
            <pre id="__sf_payload_preview" style="margin:0; padding:8px 10px; border-radius:${theme.panelRadius}; background:${theme.inputBackground}; color:${theme.inputText}; border:1px solid ${theme.inputBorder}; font-size:10px; line-height:1.45; overflow:auto; max-height:160px; white-space:pre-wrap; word-break:break-word;"></pre>
            <div style="display:flex; gap:8px; align-items:center; justify-content:space-between; flex-wrap:wrap;">
              <button id="__sf_copy_payload" type="button" style="padding:5px 9px; background:transparent; color:${theme.panelText}; border:1px solid ${theme.panelBorder}; border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px; font-family:inherit;">Copy full JSON</button>
              <span id="__sf_copy_status" style="color:${theme.mutedText}; font-size:11px; line-height:1.4;"></span>
            </div>
          </div>
        </details>
      </div>
      </div>
      <div id="__sf_footer" style="position:sticky; bottom:-14px; display:flex; gap:10px; justify-content:space-between; align-items:flex-end; margin:0 -14px -14px; padding:10px 14px 14px; background:${theme.panelBackground}; border-top:1px solid ${theme.panelBorder}; box-shadow:0 -10px 24px rgba(0,0,0,0.16);">
        <div id="__sf_footer_status" style="display:grid; gap:6px; min-width:0; flex:1;">
          <div id="__sf_status_row" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
          <div id="__sf_status_hint" style="color:${theme.mutedText}; font-size:11px; line-height:1.4;"></div>
        </div>
        <div id="__sf_footer_actions" style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button id="__sf_annotate" type="button" title="Annotate screenshot" style="padding:7px 10px; background:${theme.accentSoft}; color:${theme.panelText}; border:1px solid ${theme.accent};
                  border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px; font-family:inherit;">Annotate</button>
          <button id="__sf_clear_annotation" type="button" style="display:none; padding:7px 10px; background:transparent; color:${theme.panelText}; border:1px solid ${theme.panelBorder};
            border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px; font-family:inherit;">Clear annotation</button>
          <button id="__sf_cancel" type="button" style="padding:7px 12px; background:${theme.inputBackground}; color:${theme.panelText}; border:1px solid ${theme.panelBorder};
                  border-radius:${theme.panelRadius}; cursor:pointer; font-size:12px; font-family:inherit;">Cancel</button>
          <button id="__sf_send" type="button" style="padding:7px 14px; background:${theme.accent}; color:${theme.accentContrast}; border:none;
                  border-radius:${theme.panelRadius}; cursor:pointer; font-weight:700; font-size:12px; font-family:inherit; transition:opacity 120ms ease, transform 120ms ease;">Send feedback</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(feedbackOverlay);
  positionFeedbackOverlay(feedbackOverlay, x, y);

  const overlay = feedbackOverlay;
  const chipsContainer = overlay.querySelector("#__sf_chips") as HTMLDivElement;
  const textarea = overlay.querySelector("#__sf_text") as HTMLTextAreaElement;
  const categoryHint = overlay.querySelector(
    "#__sf_category_hint",
  ) as HTMLDivElement;
  const messageMeta = overlay.querySelector(
    "#__sf_message_meta",
  ) as HTMLDivElement;
  const messageHelper = overlay.querySelector(
    "#__sf_message_helper",
  ) as HTMLDivElement;
  const quickSummary = overlay.querySelector(
    "#__sf_quick_summary",
  ) as HTMLDivElement;
  const detailsPanel = overlay.querySelector(
    "#__sf_details_panel",
  ) as HTMLDivElement;
  const toggleDetailsButton = overlay.querySelector(
    "#__sf_toggle_details",
  ) as HTMLButtonElement;
  const validationRow = overlay.querySelector(
    "#__sf_validation_row",
  ) as HTMLDivElement;
  const shortcutsHint = overlay.querySelector(
    "#__sf_shortcuts_hint",
  ) as HTMLDivElement;
  const footer = overlay.querySelector("#__sf_footer") as HTMLDivElement;
  const footerStatus = overlay.querySelector(
    "#__sf_footer_status",
  ) as HTMLDivElement;
  const footerActions = overlay.querySelector(
    "#__sf_footer_actions",
  ) as HTMLDivElement;
  const annotateButton = overlay.querySelector(
    "#__sf_annotate",
  ) as HTMLButtonElement;
  const clearAnnotationButton = overlay.querySelector(
    "#__sf_clear_annotation",
  ) as HTMLButtonElement;
  const cancelButton = overlay.querySelector(
    "#__sf_cancel",
  ) as HTMLButtonElement;
  const closeButton = overlay.querySelector("#__sf_close") as HTMLButtonElement;
  const sendButton = overlay.querySelector("#__sf_send") as HTMLButtonElement;
  const validation = overlay.querySelector(
    "#__sf_validation",
  ) as HTMLDivElement;
  const infoPanel = overlay.querySelector("#__sf_info_panel") as HTMLDivElement;
  const infoText = overlay.querySelector("#__sf_info_text") as HTMLDivElement;
  const payloadSummary = overlay.querySelector(
    "#__sf_payload_summary",
  ) as HTMLDivElement;
  const payloadDetails = overlay.querySelector(
    "#__sf_payload_details",
  ) as HTMLDetailsElement;
  const payloadPreview = overlay.querySelector(
    "#__sf_payload_preview",
  ) as HTMLPreElement;
  const copyPayloadButton = overlay.querySelector(
    "#__sf_copy_payload",
  ) as HTMLButtonElement;
  const copyStatus = overlay.querySelector(
    "#__sf_copy_status",
  ) as HTMLSpanElement;
  const statusRow = overlay.querySelector("#__sf_status_row") as HTMLDivElement;
  const statusHint = overlay.querySelector(
    "#__sf_status_hint",
  ) as HTMLDivElement;

  function setChipState(button: HTMLButtonElement, isActive: boolean): void {
    button.style.border = `1px solid ${isActive ? theme.accent : theme.panelBorder}`;
    button.style.background = isActive ? theme.accentSoft : "transparent";
    button.style.color = theme.panelText;
    button.style.fontWeight = isActive ? "700" : "500";
    button.style.transform = isActive ? "translateY(-1px)" : "translateY(0)";
  }

  function setAnnotateButtonState(enabled: boolean, label: string): void {
    annotateButton.disabled = !enabled;
    annotateButton.textContent = label;
    annotateButton.style.opacity = enabled ? "1" : "0.55";
    annotateButton.style.cursor = enabled ? "pointer" : "not-allowed";
    annotateButton.style.background = enabled
      ? theme.accentSoft
      : theme.inputBackground;
    annotateButton.style.border = `1px solid ${enabled ? theme.accent : theme.panelBorder}`;
  }

  function updateDetailView(): void {
    detailsPanel.style.display = isExpanded ? "grid" : "none";
    infoPanel.style.display = isExpanded ? "grid" : "none";
    quickSummary.style.display = isExpanded ? "none" : "grid";
    toggleDetailsButton.textContent = isExpanded
      ? "Quick view"
      : "More details";
    toggleDetailsButton.setAttribute(
      "aria-expanded",
      isExpanded ? "true" : "false",
    );
  }

  function updateResponsiveLayout(): void {
    const compact = isCompact();

    messageMeta.style.flexDirection = compact ? "column" : "row";
    messageMeta.style.alignItems = compact ? "stretch" : "flex-end";
    messageHelper.style.whiteSpace = compact ? "normal" : "nowrap";

    validationRow.style.flexDirection = compact ? "column" : "row";
    validationRow.style.alignItems = compact ? "stretch" : "flex-start";
    shortcutsHint.style.whiteSpace = compact ? "normal" : "nowrap";

    footer.style.flexDirection = compact ? "column" : "row";
    footer.style.alignItems = compact ? "stretch" : "flex-end";
    footerStatus.style.width = compact ? "100%" : "auto";
    footerActions.style.width = compact ? "100%" : "auto";
    footerActions.style.justifyContent = compact ? "stretch" : "flex-end";

    annotateButton.style.flex = compact ? "1 1 calc(50% - 8px)" : "0 0 auto";
    clearAnnotationButton.style.flex = compact
      ? "1 1 calc(50% - 8px)"
      : "0 0 auto";
    cancelButton.style.flex = compact ? "1 1 calc(50% - 8px)" : "0 0 auto";
    sendButton.style.flex = compact ? "1 1 100%" : "0 0 auto";
  }

  function updateClearAnnotationButton(): void {
    const canClearAnnotation =
      hasAnnotatedScreenshot && !!baseScreenshot && !sending;
    clearAnnotationButton.style.display = hasAnnotatedScreenshot
      ? "inline-flex"
      : "none";
    clearAnnotationButton.disabled = !canClearAnnotation;
    clearAnnotationButton.style.opacity = canClearAnnotation ? "1" : "0.5";
    clearAnnotationButton.style.cursor = canClearAnnotation
      ? "pointer"
      : "not-allowed";
  }

  function renderStatusBadge(text: string, emphasized = false): string {
    return `<span style="padding:4px 8px; border-radius:999px; border:1px solid ${emphasized ? theme.accent : theme.panelBorder}; background:${emphasized ? theme.accentSoft : "transparent"}; color:${theme.panelText}; font-size:11px; line-height:1.2; white-space:nowrap;">${escapeHtml(text)}</span>`;
  }

  function renderPayloadBadge(text: string): string {
    return `<span style="padding:3px 7px; border-radius:999px; border:1px solid ${theme.panelBorder}; background:${theme.inputBackground}; color:${theme.panelText}; font-size:10px; line-height:1.2; white-space:nowrap;">${escapeHtml(text)}</span>`;
  }

  function updateStatus(): void {
    const badges: string[] = [];
    if (screenshotStatus === "capturing") {
      badges.push(renderStatusBadge("Capturing screenshot", true));
    } else if (screenshotStatus === "ready") {
      badges.push(renderStatusBadge("Screenshot ready", true));
    } else {
      badges.push(renderStatusBadge("Screenshot unavailable"));
    }
    if (hasAnnotatedScreenshot) {
      badges.push(renderStatusBadge("Annotation added", true));
    }
    if (sending) {
      badges.push(renderStatusBadge("Sending", true));
    }

    statusRow.innerHTML = badges.join("");

    if (sending) {
      statusHint.textContent = "Submitting feedback with the attached context.";
      infoText.textContent =
        "Snapfeed will send your message together with the current page context and the latest captured screenshot state.";
    } else if (screenshotStatus === "capturing") {
      statusHint.textContent =
        "You can keep typing while the screenshot finishes in the background.";
      infoText.textContent =
        "Message, page context, selected element metadata, recent console errors, and a screenshot once capture completes.";
    } else if (screenshotStatus === "ready") {
      statusHint.textContent = hasAnnotatedScreenshot
        ? "Your annotated screenshot will be included with this report."
        : "A screenshot is attached. Open annotate if you want to mark it up before sending.";
      infoText.textContent = hasAnnotatedScreenshot
        ? "Message, page context, selected element metadata, recent console errors, and your annotated screenshot will be sent."
        : "Message, page context, selected element metadata, recent console errors, and the captured screenshot will be sent.";
    } else {
      statusHint.textContent =
        "This report will still send page context even if screenshot capture is unavailable.";
      infoText.textContent =
        "Message, page context, selected element metadata, and recent console errors will still be sent even without a screenshot.";
    }

    if (!currentConfig?.feedback.annotations) {
      setAnnotateButtonState(false, "Annotate off");
    } else if (sending) {
      setAnnotateButtonState(
        false,
        hasAnnotatedScreenshot ? "Annotated" : "Annotate",
      );
    } else if (screenshotStatus === "ready") {
      setAnnotateButtonState(
        true,
        hasAnnotatedScreenshot ? "Edit annotation" : "Annotate",
      );
    } else if (screenshotStatus === "capturing") {
      setAnnotateButtonState(false, "Preparing…");
    } else {
      setAnnotateButtonState(false, "No screenshot");
    }

    updateClearAnnotationButton();
  }

  function updateSendButton(): void {
    const hasText = textarea.value.trim().length > 0;
    sendButton.disabled = sending || !hasText;
    sendButton.style.opacity = sendButton.disabled ? "0.45" : "1";
    sendButton.style.cursor = sendButton.disabled ? "not-allowed" : "pointer";
    sendButton.style.transform = sendButton.disabled ? "none" : "translateY(0)";
    sendButton.textContent = sending ? "Sending…" : "Send feedback";
    cancelButton.disabled = sending;
    cancelButton.style.opacity = sending ? "0.6" : "1";
    cancelButton.style.cursor = sending ? "not-allowed" : "pointer";
  }

  function buildPayloadPreview(
    includeRawScreenshot: boolean,
  ): Record<string, unknown> {
    const previewContext = { ...context };
    const consoleErrors = getConsoleErrors();
    if (consoleErrors.length > 0) previewContext.console_errors = consoleErrors;
    if (currentConfig?.user) previewContext.user = currentConfig.user;
    previewContext.category = selectedCategory;

    const sanitizedContext = sanitizeDetail(
      previewContext as Record<string, unknown>,
    );

    let screenshot: string | null;
    if (includeRawScreenshot) {
      screenshot = resolvedScreenshot ?? null;
    } else if (screenshotStatus === "capturing") {
      screenshot = "<capturing screenshot>";
    } else if (resolvedScreenshot) {
      const sizeKb = Math.round((resolvedScreenshot.length * 0.75) / 1024);
      screenshot = `<base64 jpeg omitted from preview (${sizeKb}KB)>`;
    } else {
      screenshot = null;
    }

    return {
      session_id: getSessionId(),
      seq: "<assigned when queued>",
      ts: "<assigned on send>",
      event_type: "feedback",
      page: window.location.pathname,
      target: textarea.value.trim() || null,
      detail: sanitizedContext,
      screenshot,
    };
  }

  function updatePayloadPreview(): void {
    const summaryBadges = [
      renderPayloadBadge("Message"),
      renderPayloadBadge("Context"),
      renderPayloadBadge("Element metadata"),
    ];
    if (getConsoleErrors().length > 0) {
      summaryBadges.push(renderPayloadBadge("Console errors"));
    }
    if (currentConfig?.user) {
      summaryBadges.push(renderPayloadBadge("User"));
    }
    if (screenshotStatus === "capturing") {
      summaryBadges.push(renderPayloadBadge("Screenshot pending"));
    } else if (resolvedScreenshot) {
      summaryBadges.push(
        renderPayloadBadge(
          hasAnnotatedScreenshot ? "Annotated screenshot" : "Screenshot",
        ),
      );
    }
    payloadSummary.innerHTML = summaryBadges.join("");
    payloadPreview.textContent = JSON.stringify(
      buildPayloadPreview(false),
      null,
      2,
    );
  }

  function clearValidation(): void {
    validation.textContent = "";
    textarea.style.borderColor = theme.inputBorder;
    textarea.style.boxShadow = "none";
  }

  function showValidation(message: string): void {
    validation.textContent = message;
    validation.style.color = theme.accent;
    textarea.style.borderColor = theme.accent;
    textarea.style.boxShadow = `0 0 0 1px ${theme.accentSoft}`;
  }

  function updatePlaceholder(): void {
    textarea.placeholder = getPlaceholder(selectedCategory);
    categoryHint.textContent = getCategoryHint(selectedCategory);
  }

  updatePlaceholder();
  updateStatus();
  updateSendButton();
  updatePayloadPreview();
  updateResponsiveLayout();
  updateDetailView();

  // Category chip click handling
  chipsContainer.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(
      "button[data-cat]",
    ) as HTMLButtonElement | null;
    if (!btn) return;
    selectedCategory = btn.dataset.cat as FeedbackCategory;
    chipsContainer.querySelectorAll("button").forEach((b) => {
      setChipState(b as HTMLButtonElement, b.dataset.cat === selectedCategory);
    });
    updatePlaceholder();
    updatePayloadPreview();
  });

  chipsContainer.querySelectorAll("button").forEach((button) => {
    setChipState(
      button as HTMLButtonElement,
      button.dataset.cat === selectedCategory,
    );
  });

  const focusTextarea = () => textarea.focus();
  setTimeout(focusTextarea, 0);
  setTimeout(focusTextarea, 50);
  setTimeout(focusTextarea, 150);
  textarea.addEventListener("mousedown", () => setTimeout(focusTextarea, 0));
  textarea.addEventListener("input", () => {
    clearValidation();
    updateSendButton();
    updatePayloadPreview();
  });
  textarea.addEventListener("focus", clearValidation);

  payloadDetails.addEventListener("toggle", () =>
    positionFeedbackOverlay(overlay, x, y),
  );
  toggleDetailsButton.onclick = () => {
    isExpanded = !isExpanded;
    updateDetailView();
    updateResponsiveLayout();
    positionFeedbackOverlay(overlay, x, y);
  };
  copyPayloadButton.onclick = async () => {
    const payloadJson = JSON.stringify(buildPayloadPreview(true), null, 2);
    try {
      await navigator.clipboard.writeText(payloadJson);
      copyStatus.textContent = "Copied full payload.";
    } catch {
      copyStatus.textContent = "Copy failed in this environment.";
    }
  };

  clearAnnotationButton.onclick = () => {
    if (!baseScreenshot || clearAnnotationButton.disabled) return;
    resolvedScreenshot = baseScreenshot;
    pendingScreenshot = Promise.resolve(baseScreenshot);
    hasAnnotatedScreenshot = false;
    screenshotStatus = "ready";
    copyStatus.textContent = "Annotation cleared.";
    updateStatus();
    updatePayloadPreview();
    positionFeedbackOverlay(overlay, x, y);
  };

  options.initialBaseScreenshotPromise
    ?.then((screenshot) => {
      if (typeof baseScreenshot === "undefined") {
        baseScreenshot = screenshot;
        updateStatus();
      }
    })
    .catch(() => {
      if (typeof baseScreenshot === "undefined") {
        baseScreenshot = null;
        updateStatus();
      }
    });

  pendingScreenshot
    ?.then((screenshot) => {
      resolvedScreenshot = screenshot;
      if (typeof baseScreenshot === "undefined") {
        baseScreenshot = screenshot;
      }
      screenshotStatus = screenshot ? "ready" : "unavailable";
      updateStatus();
      updatePayloadPreview();
      positionFeedbackOverlay(overlay, x, y);
    })
    .catch(() => {
      resolvedScreenshot = null;
      screenshotStatus = "unavailable";
      updateStatus();
      updatePayloadPreview();
      positionFeedbackOverlay(overlay, x, y);
    });

  const repositionOverlay = () => {
    updateResponsiveLayout();
    positionFeedbackOverlay(overlay, x, y);
  };
  window.addEventListener("resize", repositionOverlay);

  const close = () => {
    window.removeEventListener("resize", repositionOverlay);
    dismissFeedbackDialog();
  };

  cancelButton.onclick = close;
  closeButton.onclick = close;

  // Annotate button — opens annotation canvas on the screenshot
  annotateButton.onclick = async () => {
    if (annotateButton.disabled) return;
    if (!currentConfig?.feedback.annotations) return;
    const screenshot = await pendingScreenshot;
    if (!screenshot) return;
    if (typeof baseScreenshot === "undefined") {
      baseScreenshot = screenshot;
    }
    overlay.style.display = "none";
    const annotated = await showAnnotationCanvas(
      screenshot,
      currentConfig.feedback.screenshotQuality,
    );
    overlay.style.display = "";
    if (annotated) {
      hasAnnotatedScreenshot = true;
      screenshotStatus = "ready";
      resolvedScreenshot = annotated;
      pendingScreenshot = Promise.resolve(annotated);
      updateStatus();
      updatePayloadPreview();
      positionFeedbackOverlay(overlay, x, y);
    }
  };

  const submit = async () => {
    const text = textarea.value.trim();
    if (!text) {
      showValidation("Add a short note before sending this feedback.");
      focusTextarea();
      return;
    }

    sending = true;
    clearValidation();
    updateStatus();
    updateSendButton();

    const screenshot = await pendingScreenshot;

    // Enrich context with console errors and user identity
    const consoleErrors = getConsoleErrors();
    if (consoleErrors.length > 0) context.console_errors = consoleErrors;
    if (currentConfig?.user) context.user = currentConfig.user;
    context.category = selectedCategory;

    // Sanitize before sending
    const sanitizedContext = sanitizeDetail(context as Record<string, unknown>);

    push("feedback", text, sanitizedContext, screenshot);
    flush();

    // Also send to adapters if configured
    if (currentConfig?.adapters.length) {
      const event = {
        session_id: "",
        seq: 0,
        ts: new Date().toISOString(),
        event_type: "feedback",
        page: window.location.pathname,
        target: text,
        detail: sanitizedContext,
        screenshot,
      };
      for (const adapter of currentConfig.adapters) {
        try {
          adapter.send(event);
        } catch {
          /* adapter errors should not break feedback */
        }
      }
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
    close();
  };

  sendButton.onclick = () => {
    if (sendButton.disabled) {
      if (!textarea.value.trim()) {
        showValidation("Add a short note before sending this feedback.");
        focusTextarea();
      }
      return;
    }
    void submit();
  };
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (sendButton.disabled) {
        showValidation("Add a short note before sending this feedback.");
        focusTextarea();
        return;
      }
      void submit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
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
