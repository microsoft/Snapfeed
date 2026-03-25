/**
 * Feedback dialog — Cmd+Click visual feedback with screenshots.
 *
 * The dialog is now a thin UI wrapper over a headless feedback controller.
 * Consumers can replace the built-in UI by supplying `feedback.onTrigger`
 * while keeping the same capture, queue, and submission behavior.
 */

import {
  createHeadlessFeedbackController,
  gatherContext,
} from "./feedback-controller.js";
import type {
  FeedbackCategory,
  FeedbackController,
  FeedbackStatusTone,
  FeedbackTrigger,
  ResolvedConfig,
} from "./types.js";
import { FEEDBACK_CATEGORIES } from "./types.js";
import {
  getSnapfeedTheme,
  setSnapfeedStylePreset,
  setSnapfeedTheme,
} from "./ui-theme.js";

let feedbackOverlay: HTMLDivElement | null = null;
let currentConfig: ResolvedConfig | null = null;
let activeController: FeedbackController | null = null;
let overlayCleanup: (() => void) | null = null;

const OVERLAY_MARGIN = 12;
const OVERLAY_GAP = 12;

export { gatherContext };

export function dismissFeedbackDialog(): void {
  overlayCleanup?.();
  overlayCleanup = null;
  activeController?.dispose();
  activeController = null;
  feedbackOverlay?.remove();
  feedbackOverlay = null;
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

function getRequiredElement<T extends HTMLElement>(
  parent: ParentNode,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing feedback dialog element: ${selector}`);
  }

  return element;
}

function isFeedbackController(
  value: Element | FeedbackController,
): value is FeedbackController {
  return typeof (value as FeedbackController).getSnapshot === "function";
}

function getResolvedConfig(): ResolvedConfig {
  if (!currentConfig) {
    throw new Error(
      "Snapfeed feedback must be initialized before creating feedback controllers.",
    );
  }

  return currentConfig;
}

export function createFeedbackController(
  trigger: FeedbackTrigger,
): FeedbackController {
  return createHeadlessFeedbackController(getResolvedConfig(), trigger);
}

export function getFeedbackTrigger(e: MouseEvent): FeedbackTrigger | null {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return null;

  const element = e.target as Element | null;
  if (!element) return null;
  if (feedbackOverlay?.contains(element)) return null;

  return {
    element,
    x: e.clientX,
    y: e.clientY,
  };
}

export function showFeedbackDialog(el: Element, x: number, y: number): void;
export function showFeedbackDialog(controller: FeedbackController): void;
export function showFeedbackDialog(
  targetOrController: Element | FeedbackController,
  x?: number,
  y?: number,
): void {
  dismissFeedbackDialog();

  const controller = isFeedbackController(targetOrController)
    ? targetOrController
    : createFeedbackController({
        element: targetOrController,
        x: x ?? 0,
        y: y ?? 0,
      });
  const theme = getSnapfeedTheme();
  const feedbackConfig = getResolvedConfig().feedback;
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

  let snapshot = controller.getSnapshot();
  let detailsExpanded = false;
  let payloadPreviewExpanded = false;
  let destroyed = false;

  feedbackOverlay = document.createElement("div");
  activeController = controller;
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

  const chipsHtml = FEEDBACK_CATEGORIES.map(
    (category) =>
      `<button type="button" data-cat="${category.id}" style="padding:4px 10px; border-radius:12px; border:1px solid ${category.id === snapshot.category ? theme.accent : theme.panelBorder};
      background:${category.id === snapshot.category ? theme.accentSoft : "transparent"}; color:${theme.panelText}; cursor:pointer;
      font-size:12px; font-family:inherit; white-space:nowrap;">${category.emoji} ${category.label}</button>`,
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
      <div style="margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${escapeAttribute(snapshot.breadcrumb)}">${snapshot.breadcrumb}</div>
      <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap"
        title="${escapeAttribute(snapshot.targetLabel)}">→ ${snapshot.targetLabel}</div>
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
          <input id="__sf_include_screenshot" type="checkbox" ${snapshot.includeScreenshot ? "checked" : ""} />
          <span>Attach screenshot</span>
        </label>
        <label id="__sf_context_row" style="display:${contextControlVisible ? "inline-flex" : "none"}; gap:6px; align-items:center; cursor:pointer;">
          <input id="__sf_include_context" type="checkbox" ${snapshot.includeContext ? "checked" : ""} />
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
  const textarea = getRequiredElement<HTMLTextAreaElement>(
    overlay,
    "#__sf_text",
  );
  const chipsContainer = getRequiredElement<HTMLDivElement>(
    overlay,
    "#__sf_chips",
  );
  const status = getRequiredElement<HTMLDivElement>(overlay, "#__sf_status");
  const detailsToggle = overlay.querySelector<HTMLButtonElement>(
    "#__sf_details_toggle",
  );
  const detailsLabel = overlay.querySelector<HTMLSpanElement>(
    "#__sf_details_label",
  );
  const detailsChevron = overlay.querySelector<HTMLSpanElement>(
    "#__sf_details_chevron",
  );
  const detailsPanel = overlay.querySelector<HTMLDivElement>("#__sf_controls");
  const payloadToggle = overlay.querySelector<HTMLButtonElement>(
    "#__sf_payload_toggle",
  );
  const payloadLabel = overlay.querySelector<HTMLSpanElement>(
    "#__sf_payload_label",
  );
  const payloadChevron = overlay.querySelector<HTMLSpanElement>(
    "#__sf_payload_chevron",
  );
  const payloadPreview = overlay.querySelector<HTMLPreElement>(
    "#__sf_payload_preview",
  );
  const sendButton = getRequiredElement<HTMLButtonElement>(
    overlay,
    "#__sf_send",
  );
  const cancelButton = getRequiredElement<HTMLButtonElement>(
    overlay,
    "#__sf_cancel",
  );
  const closeButton = getRequiredElement<HTMLButtonElement>(
    overlay,
    "#__sf_close",
  );
  const annotateButton = getRequiredElement<HTMLButtonElement>(
    overlay,
    "#__sf_annotate",
  );
  const screenshotCheckbox = overlay.querySelector<HTMLInputElement>(
    "#__sf_include_screenshot",
  );
  const contextCheckbox = overlay.querySelector<HTMLInputElement>(
    "#__sf_include_context",
  );
  const chipButtons = Array.from(
    chipsContainer.querySelectorAll<HTMLButtonElement>("button[data-cat]"),
  );
  let positionRaf = 0;

  const unsubscribe = controller.subscribe((nextSnapshot) => {
    snapshot = nextSnapshot;
    if (textarea.value !== nextSnapshot.text) {
      textarea.value = nextSnapshot.text;
    }
    updateUi();
  });

  const toneStyles: Record<
    FeedbackStatusTone,
    { background: string; color: string }
  > = {
    success: { background: theme.accentSoft, color: theme.panelText },
    warning: {
      background: "rgba(250, 204, 21, 0.12)",
      color: theme.panelText,
    },
    error: {
      background: "rgba(248, 113, 113, 0.14)",
      color: theme.panelText,
    },
  };

  const isActiveOverlay = () => feedbackOverlay === overlay && !destroyed;

  const schedulePosition = () => {
    if (!isActiveOverlay()) return;
    if (positionRaf) cancelAnimationFrame(positionRaf);
    positionRaf = requestAnimationFrame(() => {
      positionRaf = 0;
      if (!isActiveOverlay()) return;
      positionOverlay(overlay, snapshot.x, snapshot.y);
    });
  };

  const getDetailsSummary = (): string => {
    const parts: string[] = [];
    if (screenshotControlVisible) {
      parts.push(
        snapshot.includeScreenshot ? "Screenshot on" : "Screenshot off",
      );
    }
    if (contextControlVisible) {
      parts.push(snapshot.includeContext ? "Context on" : "Context off");
    }
    return parts.length > 0 ? `Details · ${parts.join(" · ")}` : "Details";
  };

  const updateStatus = (message: string, tone?: FeedbackStatusTone) => {
    status.textContent = message;
    status.style.padding = message ? "8px 10px" : "0";
    status.style.borderRadius = theme.panelRadius;
    if (tone) {
      status.style.background = toneStyles[tone].background;
      status.style.color = toneStyles[tone].color;
      return;
    }

    status.style.background = "transparent";
    status.style.color = theme.mutedText;
  };

  const updateUi = () => {
    const isSubmitting = snapshot.submitState.kind === "submitting";
    const completion =
      snapshot.submitState.kind === "complete" ? snapshot.submitState : null;
    const hasText = snapshot.text.trim().length > 0;

    textarea.disabled = isSubmitting || completion !== null;
    chipButtons.forEach((button) => {
      const isActive = button.dataset.cat === snapshot.category;
      button.disabled = isSubmitting || completion !== null;
      button.style.border = `1px solid ${isActive ? theme.accent : theme.panelBorder}`;
      button.style.background = isActive ? theme.accentSoft : "transparent";
      button.style.opacity = isSubmitting || completion !== null ? "0.65" : "1";
      button.style.cursor =
        isSubmitting || completion !== null ? "not-allowed" : "pointer";
    });

    if (screenshotCheckbox) {
      screenshotCheckbox.checked = snapshot.includeScreenshot;
      screenshotCheckbox.disabled =
        isSubmitting ||
        completion !== null ||
        snapshot.screenshotState === "unavailable" ||
        !allowScreenshotToggle;
    }
    if (contextCheckbox) {
      contextCheckbox.checked = snapshot.includeContext;
      contextCheckbox.disabled =
        isSubmitting || completion !== null || !allowContextToggle;
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
          controller.getPayloadPreview(),
          null,
          2,
        );
      }
    }

    setButtonEnabled(
      annotateButton,
      Boolean(
        feedbackConfig.annotations &&
        snapshot.includeScreenshot &&
        snapshot.screenshotState === "ready" &&
        !isSubmitting &&
        completion === null,
      ),
    );
    setButtonEnabled(cancelButton, !isSubmitting);
    setButtonEnabled(closeButton, !isSubmitting);

    if (completion) {
      sendButton.textContent = "Close";
      setButtonEnabled(sendButton, true);
      cancelButton.style.display = "none";
      updateStatus(completion.message, completion.tone);
      schedulePosition();
      return;
    }

    cancelButton.style.display = "";
    sendButton.textContent = isSubmitting
      ? snapshot.includeScreenshot && snapshot.screenshotState === "pending"
        ? "Preparing..."
        : "Sending..."
      : "Send";
    setButtonEnabled(sendButton, !isSubmitting && hasText);

    if (isSubmitting) {
      updateStatus(
        snapshot.includeScreenshot && snapshot.screenshotState === "pending"
          ? "Finishing screenshot capture before sending. You can keep the dialog open."
          : "Sending feedback...",
      );
      schedulePosition();
      return;
    }

    if (!snapshot.includeScreenshot) {
      updateStatus("Screenshot will be skipped for this report.");
      schedulePosition();
      return;
    }

    if (snapshot.screenshotState === "pending") {
      updateStatus(
        "Preparing screenshot in the background. You can keep typing while it finishes.",
      );
      schedulePosition();
      return;
    }

    if (snapshot.screenshotState === "ready") {
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

  chipsContainer.addEventListener("click", (e) => {
    const button = (e.target as HTMLElement).closest(
      "button[data-cat]",
    ) as HTMLButtonElement | null;
    if (!button || snapshot.submitState.kind !== "idle") return;
    controller.setCategory(button.dataset.cat as FeedbackCategory);
  });

  const focusTextarea = () => {
    if (!isActiveOverlay() || snapshot.submitState.kind !== "idle") return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };

  textarea.value = snapshot.text;
  requestAnimationFrame(() => {
    focusTextarea();
    if (document.activeElement !== textarea) {
      setTimeout(focusTextarea, 0);
    }
  });
  textarea.addEventListener("input", () => {
    controller.setText(textarea.value);
  });

  const close = () => {
    if (snapshot.submitState.kind === "submitting") return;
    dismissFeedbackDialog();
  };

  cancelButton.onclick = close;
  closeButton.onclick = close;

  screenshotCheckbox?.addEventListener("change", () => {
    if (snapshot.submitState.kind !== "idle") return;
    if (!screenshotCheckbox.checked) detailsExpanded = true;
    controller.setIncludeScreenshot(screenshotCheckbox.checked);
  });
  contextCheckbox?.addEventListener("change", () => {
    if (snapshot.submitState.kind !== "idle") return;
    if (!contextCheckbox.checked) detailsExpanded = true;
    controller.setIncludeContext(contextCheckbox.checked);
  });

  detailsToggle?.addEventListener("click", () => {
    if (snapshot.submitState.kind !== "idle") return;
    detailsExpanded = !detailsExpanded;
    updateUi();
  });

  payloadToggle?.addEventListener("click", () => {
    if (snapshot.submitState.kind !== "idle") return;
    payloadPreviewExpanded = !payloadPreviewExpanded;
    detailsExpanded = true;
    updateUi();
  });

  annotateButton.onclick = async () => {
    if (!feedbackConfig.annotations || snapshot.submitState.kind !== "idle")
      return;
    overlay.style.display = "none";
    await controller.annotate();
    if (!isActiveOverlay()) return;
    overlay.style.display = "";
    focusTextarea();
    updateUi();
  };

  const submit = async () => {
    if (!isActiveOverlay()) return;
    if (snapshot.submitState.kind === "complete") {
      close();
      return;
    }
    if (snapshot.submitState.kind === "submitting") return;
    if (!snapshot.text.trim()) {
      focusTextarea();
      updateUi();
      return;
    }

    await controller.submit();
    if (!isActiveOverlay()) return;
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
  overlayCleanup = () => {
    destroyed = true;
    unsubscribe();
    if (positionRaf) cancelAnimationFrame(positionRaf);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("resize", onViewportChange);
    window.visualViewport?.removeEventListener("scroll", onViewportChange);
  };

  updateUi();
  schedulePosition();
}

export function handleCtrlClick(e: MouseEvent): void {
  const trigger = getFeedbackTrigger(e);
  if (!trigger) return;

  e.preventDefault();
  e.stopPropagation();

  const controller = createFeedbackController(trigger);
  const config = getResolvedConfig();
  if (config.feedback.onTrigger) {
    config.feedback.onTrigger(controller, trigger);
    return;
  }

  showFeedbackDialog(controller);
}

export function initFeedback(config: ResolvedConfig): void {
  currentConfig = config;
  if (config.themePreset) {
    setSnapfeedStylePreset(config.themePreset);
    return;
  }

  setSnapfeedTheme(config.theme);
}
