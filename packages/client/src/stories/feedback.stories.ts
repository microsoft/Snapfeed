import type { Meta, StoryObj } from "@storybook/html";
import { createFeedbackController } from "../feedback.js";
import { initSnapfeed } from "../index.js";
import type {
  FeedbackCategory,
  FeedbackController,
  FeedbackTrigger,
} from "../types.js";
import { resolveConfig } from "../types.js";
import {
  cleanupStorySurface,
  configureFeedbackStory,
  createFixtureCard,
  openFeedbackForFixture,
  renderStoryShell,
  type StoryPreset,
} from "./storybook-utils.js";

const meta = {
  title: "Snapfeed/Feedback Overlay",
} satisfies Meta;

export default meta;

type Story = StoryObj;

let activeStoryTeardown: (() => void) | null = null;

function resetStoryRuntime(): void {
  activeStoryTeardown?.();
  activeStoryTeardown = null;
}

function createCustomPanelCleanup(): () => void {
  document
    .querySelector('[data-snapfeed-overlay="custom-feedback-panel"]')
    ?.remove();
  return () => {
    document
      .querySelector('[data-snapfeed-overlay="custom-feedback-panel"]')
      ?.remove();
  };
}

function mountCustomFeedbackPanel(controller: FeedbackController): void {
  const clearPanel = createCustomPanelCleanup();
  const panel = document.createElement("section");
  panel.dataset.snapfeedOverlay = "custom-feedback-panel";
  panel.style.cssText = `
    position: fixed;
    right: 24px;
    top: 24px;
    width: min(420px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    padding: 18px;
    border-radius: 28px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background:
      linear-gradient(160deg, rgba(255,255,255,0.96), rgba(240,249,255,0.92)),
      radial-gradient(circle at top right, rgba(14, 165, 233, 0.14), transparent 38%);
    box-shadow: 0 30px 80px rgba(15, 23, 42, 0.22);
    color: #0f172a;
    font-family: 'Avenir Next', 'Segoe UI', sans-serif;
    z-index: 100001;
    backdrop-filter: blur(14px);
  `;
  document.body.appendChild(panel);

  const close = () => {
    unsubscribe();
    controller.dispose();
    clearPanel();
  };

  const render = () => {
    const snapshot = controller.getSnapshot();
    const annotateDisabled =
      snapshot.submitState.kind !== "idle" ||
      !snapshot.includeScreenshot ||
      snapshot.screenshotState !== "ready";
    const sendDisabled =
      snapshot.submitState.kind === "submitting" || !snapshot.text.trim();
    const statusText =
      snapshot.submitState.kind === "complete"
        ? snapshot.submitState.message
        : snapshot.screenshotState === "pending" && snapshot.includeScreenshot
          ? "Preparing screenshot in the background."
          : snapshot.screenshotState === "ready" && snapshot.includeScreenshot
            ? "Screenshot ready to send."
            : "Text-only feedback is active.";

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:16px;">
        <div>
          <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#0284c7; margin-bottom:8px;">Bring Your Own UI</div>
          <h2 style="margin:0 0 8px; font-size:28px; line-height:1.05;">Custom feedback overlay</h2>
          <p style="margin:0; color:#475569; line-height:1.55; font-size:14px;">This panel is not Snapfeed's default dialog. It is a custom surface mounted on top of the headless feedback controller.</p>
        </div>
        <button type="button" id="__sf_custom_close" style="border:none; background:none; color:#64748b; cursor:pointer; font-size:18px; line-height:1; padding:2px 4px;">✕</button>
      </div>
      <div style="display:grid; gap:14px;">
        <div style="padding:14px; border-radius:20px; background:rgba(14,165,233,0.08); border:1px solid rgba(14,165,233,0.14);">
          <div style="font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#0369a1; margin-bottom:8px;">Target</div>
          <div style="font-size:15px; font-weight:600; margin-bottom:6px;">${snapshot.targetLabel}</div>
          <div style="font-size:13px; color:#475569; line-height:1.5;">${snapshot.breadcrumb}</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${["bug", "idea", "question", "praise", "other"]
            .map((category) => {
              const isActive = snapshot.category === category;
              return `<button type="button" data-custom-cat="${category}" style="padding:7px 12px; border-radius:999px; border:1px solid ${isActive ? "#0284c7" : "rgba(148,163,184,0.32)"}; background:${isActive ? "rgba(14,165,233,0.12)" : "rgba(255,255,255,0.8)"}; color:#0f172a; cursor:pointer; font-size:12px;">${category}</button>`;
            })
            .join("")}
        </div>
        <textarea id="__sf_custom_text" rows="5" style="width:100%; box-sizing:border-box; resize:vertical; min-height:120px; border-radius:20px; border:1px solid rgba(148,163,184,0.32); background:rgba(255,255,255,0.88); color:#0f172a; padding:14px; font-size:14px; line-height:1.55; font-family:inherit;" placeholder="Describe the change you want to make.">${snapshot.text}</textarea>
        <div style="display:grid; gap:10px; grid-template-columns: repeat(2, minmax(0, 1fr));">
          <label style="display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:18px; background:rgba(15,23,42,0.04); color:#1e293b; font-size:13px;">
            <input id="__sf_custom_screenshot" type="checkbox" ${snapshot.includeScreenshot ? "checked" : ""} ${snapshot.submitState.kind !== "idle" || snapshot.screenshotState === "unavailable" ? "disabled" : ""} />
            <span>Attach screenshot</span>
          </label>
          <label style="display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:18px; background:rgba(15,23,42,0.04); color:#1e293b; font-size:13px;">
            <input id="__sf_custom_context" type="checkbox" ${snapshot.includeContext ? "checked" : ""} ${snapshot.submitState.kind !== "idle" ? "disabled" : ""} />
            <span>Attach context</span>
          </label>
        </div>
        <div style="padding:14px; border-radius:20px; background:rgba(15,23,42,0.04); border:1px solid rgba(148,163,184,0.18);">
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:8px;">
            <div style="font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#64748b;">Payload Preview</div>
            <div style="font-size:12px; color:#475569;">${snapshot.screenshotState}</div>
          </div>
          <pre style="margin:0; white-space:pre-wrap; word-break:break-word; font-size:11px; line-height:1.55; color:#0f172a;">${JSON.stringify(controller.getPayloadPreview(), null, 2)}</pre>
        </div>
        <div id="__sf_custom_status" style="padding:12px 14px; border-radius:18px; background:${snapshot.submitState.kind === "complete" ? "rgba(34,197,94,0.12)" : "rgba(15,23,42,0.04)"}; color:#334155; font-size:13px; line-height:1.5;">${statusText}</div>
        <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button type="button" id="__sf_custom_annotate" ${annotateDisabled ? "disabled" : ""} style="padding:10px 14px; border-radius:999px; border:1px solid rgba(2,132,199,0.24); background:rgba(14,165,233,0.12); color:#0f172a; cursor:${annotateDisabled ? "not-allowed" : "pointer"}; opacity:${annotateDisabled ? "0.55" : "1"}; font-size:12px;">Annotate</button>
          <button type="button" id="__sf_custom_send" ${sendDisabled ? "disabled" : ""} style="padding:10px 16px; border-radius:999px; border:none; background:#0f172a; color:#f8fafc; cursor:${sendDisabled ? "not-allowed" : "pointer"}; opacity:${sendDisabled ? "0.55" : "1"}; font-size:12px; font-weight:600;">${snapshot.submitState.kind === "complete" ? "Close" : snapshot.submitState.kind === "submitting" ? "Sending..." : "Send feedback"}</button>
        </div>
      </div>
    `;

    panel
      .querySelector<HTMLButtonElement>("#__sf_custom_close")
      ?.addEventListener("click", close);
    panel
      .querySelector<HTMLTextAreaElement>("#__sf_custom_text")
      ?.addEventListener("input", (event) => {
        controller.setText((event.currentTarget as HTMLTextAreaElement).value);
      });
    panel
      .querySelectorAll<HTMLButtonElement>("button[data-custom-cat]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          controller.setCategory(button.dataset.customCat as FeedbackCategory);
        });
      });
    panel
      .querySelector<HTMLInputElement>("#__sf_custom_screenshot")
      ?.addEventListener("change", (event) => {
        controller.setIncludeScreenshot(
          (event.currentTarget as HTMLInputElement).checked,
        );
      });
    panel
      .querySelector<HTMLInputElement>("#__sf_custom_context")
      ?.addEventListener("change", (event) => {
        controller.setIncludeContext(
          (event.currentTarget as HTMLInputElement).checked,
        );
      });
    panel
      .querySelector<HTMLButtonElement>("#__sf_custom_annotate")
      ?.addEventListener("click", () => {
        void controller.annotate();
      });
    panel
      .querySelector<HTMLButtonElement>("#__sf_custom_send")
      ?.addEventListener("click", () => {
        if (snapshot.submitState.kind === "complete") {
          close();
          return;
        }
        void controller.submit();
      });
  };

  const unsubscribe = controller.subscribe(render);
  render();
}

function openCustomFeedback(
  target: Element,
  onTrigger: (controller: FeedbackController, trigger: FeedbackTrigger) => void,
): void {
  const rect = target.getBoundingClientRect();
  const trigger = {
    element: target,
    x: rect.left + rect.width / 2,
    y: rect.top + 28,
  };
  const controller = createFeedbackController(trigger);
  onTrigger(controller, trigger);
}

function renderFeedbackPreset(
  preset: StoryPreset,
  title: string,
  subtitle: string,
): HTMLDivElement {
  resetStoryRuntime();
  let hasAutoOpened = false;
  const root = renderStoryShell(title, subtitle);
  const fixture = createFixtureCard();
  root.appendChild(fixture);

  configureFeedbackStory(
    preset,
    resolveConfig({
      feedback: {
        enabled: true,
        annotations: true,
        screenshotQuality: 0.8,
        allowScreenshotToggle: true,
        allowContextToggle: true,
        defaultIncludeScreenshot: true,
        defaultIncludeContext: true,
      },
      captureConsoleErrors: false,
      trackApiErrors: false,
      trackClicks: false,
      trackErrors: false,
      trackNavigation: false,
      user: {
        name: "Storybook Preview",
        email: "preview@snapfeed.dev",
      },
    }),
  );

  const target = fixture.querySelector("#feedback-target");
  if (target) {
    target.addEventListener("click", () => openFeedbackForFixture(target));

    requestAnimationFrame(() => {
      if (hasAutoOpened) {
        return;
      }
      hasAutoOpened = true;
      openFeedbackForFixture(target);
    });
  }

  return root;
}

function renderCustomFeedbackPreset(
  preset: StoryPreset,
  title: string,
  subtitle: string,
): HTMLDivElement {
  resetStoryRuntime();
  let hasAutoOpened = false;
  cleanupStorySurface();
  const root = renderStoryShell(title, subtitle);
  const fixture = createFixtureCard();
  root.appendChild(fixture);

  const onTrigger = (controller: FeedbackController) => {
    mountCustomFeedbackPanel(controller);
  };

  configureFeedbackStory(
    preset,
    resolveConfig({
      feedback: {
        enabled: false,
        annotations: true,
        screenshotQuality: 0.8,
        allowScreenshotToggle: true,
        allowContextToggle: true,
        defaultIncludeScreenshot: true,
        defaultIncludeContext: true,
        onTrigger,
      },
      captureConsoleErrors: false,
      trackApiErrors: false,
      trackClicks: false,
      trackErrors: false,
      trackNavigation: false,
      user: {
        name: "Storybook Preview",
        email: "preview@snapfeed.dev",
      },
    }),
  );

  const target = fixture.querySelector("#feedback-target");
  const aside = fixture.querySelector("aside");

  if (aside) {
    aside.innerHTML = `
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#86efac; margin-bottom:12px;">Custom UI flow</div>
      <ol style="margin:0; padding-left:18px; color:#cbd5e1; line-height:1.8;">
        <li>The card still provides the target element and click anchor.</li>
        <li>The Storybook panel on the right is mounted by your own callback.</li>
        <li>The payload preview and submit actions come from the controller.</li>
        <li>You can close and reopen the panel by clicking the result card again.</li>
      </ol>
    `;
  }

  if (target) {
    target.addEventListener("click", () =>
      openCustomFeedback(target, onTrigger),
    );

    requestAnimationFrame(() => {
      if (hasAutoOpened) return;
      hasAutoOpened = true;
      openCustomFeedback(target, onTrigger);
    });
  }

  return root;
}

function dispatchCustomTrigger(target: Element): void {
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + 28,
    }),
  );
}

function renderCustomFeedbackInitPreset(
  title: string,
  subtitle: string,
): HTMLDivElement {
  resetStoryRuntime();
  let hasAutoOpened = false;
  cleanupStorySurface();
  const root = renderStoryShell(title, subtitle);
  const fixture = createFixtureCard();
  root.appendChild(fixture);

  const onTrigger = (controller: FeedbackController) => {
    mountCustomFeedbackPanel(controller);
  };

  activeStoryTeardown = initSnapfeed({
    endpoint: "/api/storybook-feedback",
    captureConsoleErrors: false,
    trackApiErrors: false,
    trackClicks: false,
    trackErrors: false,
    trackNavigation: false,
    networkLog: { enabled: false },
    sessionReplay: { enabled: false },
    feedback: {
      enabled: false,
      annotations: true,
      screenshotQuality: 0.8,
      allowScreenshotToggle: true,
      allowContextToggle: true,
      defaultIncludeScreenshot: true,
      defaultIncludeContext: true,
      onTrigger,
    },
    user: {
      name: "Storybook Preview",
      email: "preview@snapfeed.dev",
    },
  });

  const aside = fixture.querySelector("aside");
  if (aside) {
    aside.innerHTML = `
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#86efac; margin-bottom:12px;">Config-driven flow</div>
      <ol style="margin:0; padding-left:18px; color:#cbd5e1; line-height:1.8;">
        <li>This story boots Snapfeed through <code>initSnapfeed</code>.</li>
        <li>The target card fires a real Cmd-click style trigger event.</li>
        <li><code>feedback.onTrigger</code> swaps the stock dialog for the custom panel.</li>
        <li>The controller still owns screenshot capture, payload preview, and submit.</li>
      </ol>
    `;
  }

  const target = fixture.querySelector("#feedback-target");
  if (target) {
    target.addEventListener("click", (event) => {
      if ((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey) {
        return;
      }
      dispatchCustomTrigger(target);
    });

    requestAnimationFrame(() => {
      if (hasAutoOpened) return;
      hasAutoOpened = true;
      dispatchCustomTrigger(target);
    });
  }

  return root;
}

export const Modern: Story = {
  render: () =>
    renderFeedbackPreset(
      "modern",
      "Modern feedback overlay",
      "A clean default treatment that keeps the current Snapfeed feel but exposes it as a visual surface you can tune.",
    ),
};

export const Windows90s: Story = {
  render: () =>
    renderFeedbackPreset(
      "windows90s",
      "Windows 90s feedback overlay",
      "Classic desktop chrome with hard edges, system-font density, and high-contrast framing so you can judge whether the interaction benefits from a more literal operating-system feel.",
    ),
};

export const Terminal: Story = {
  render: () =>
    renderFeedbackPreset(
      "terminal",
      "Terminal feedback overlay",
      "A utilitarian preset that shows how the same interaction reads with monospaced typography and flatter chrome.",
    ),
};

export const GitHubLight: Story = {
  render: () =>
    renderFeedbackPreset(
      "githubLight",
      "GitHub Light feedback overlay",
      "A familiar light preset with restrained borders and clearer daylight contrast for teams that prefer product UI chrome over modal-heavy dark surfaces.",
    ),
};

export const Dracula: Story = {
  render: () =>
    renderFeedbackPreset(
      "dracula",
      "Dracula feedback overlay",
      "A high-recognition editor-inspired preset with saturated accent treatment, useful for checking whether stronger emphasis improves action hierarchy.",
    ),
};

export const Nord: Story = {
  render: () =>
    renderFeedbackPreset(
      "nord",
      "Nord feedback overlay",
      "A cooler slate preset that keeps the interface subdued while preserving clearer structure than the terminal treatment.",
    ),
};

export const CustomUi: Story = {
  render: () =>
    renderCustomFeedbackPreset(
      "modern",
      "Custom feedback overlay",
      "A bring-your-own UI example that keeps Snapfeed capture, screenshot, queueing, and payload generation while replacing the default dialog with a bespoke panel.",
    ),
};

export const CustomUiViaInit: Story = {
  render: () =>
    renderCustomFeedbackInitPreset(
      "Config-driven custom feedback overlay",
      "A full init path example that uses initSnapfeed and feedback.onTrigger to intercept Cmd-click feedback and mount a custom UI surface.",
    ),
};
