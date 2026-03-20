import type { Meta, StoryObj } from "@storybook/html";
import {
  openAnnotationStory,
  renderStoryShell,
  type StoryPreset,
} from "./storybook-utils.js";

const meta = {
  title: "Snapfeed/Annotation Canvas",
} satisfies Meta;

export default meta;

type Story = StoryObj;

function renderAnnotationLaunch(
  preset: StoryPreset,
  title: string,
  subtitle: string,
): HTMLDivElement {
  const root = renderStoryShell(title, subtitle);
  const section = document.createElement("section");
  let hasAutoOpened = false;
  section.style.cssText = `
    max-width: 960px;
    margin: 0 auto;
    padding: 28px;
    border-radius: 28px;
    background: rgba(15,23,42,0.74);
    border: 1px solid rgba(148,163,184,0.16);
    box-shadow: 0 24px 70px rgba(15,23,42,0.35);
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr);
    gap: 24px;
  `;
  section.innerHTML = `
    <article id="annotation-target" style="cursor:pointer; transition:transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease; border-radius:24px; padding:6px;">
      <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#67e8f9; margin-bottom:12px;">Canvas Preview</div>
      <h2 style="margin:0 0 10px; font-size:30px; color:#f8fafc;">Annotation canvas opens automatically</h2>
      <p style="margin:0 0 18px; color:#cbd5e1; line-height:1.7;">This story launches the real drawing canvas as soon as it renders. If you close it and want to inspect again, click this preview to reopen it.</p>
      <div style="padding:22px; border-radius:22px; background:linear-gradient(145deg, rgba(30,41,59,0.96), rgba(15,23,42,0.96)); border:1px solid rgba(103,232,249,0.24); box-shadow:0 18px 48px rgba(15,23,42,0.35);">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:20px;">
          <div>
            <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#93c5fd; margin-bottom:10px;">Mock Screenshot</div>
            <div style="font-size:24px; font-weight:700; color:#f8fafc; margin-bottom:8px;">Toolbar chrome test surface</div>
            <div style="color:#cbd5e1; line-height:1.6; max-width:520px;">The overlay should already be open. Use this card only if you want to relaunch it after dismissing the canvas.</div>
          </div>
          <div style="padding:10px 14px; border-radius:999px; background:rgba(34,211,238,0.14); color:#a5f3fc; font-size:12px; text-transform:uppercase; letter-spacing:0.14em; white-space:nowrap;">Auto-open on load</div>
        </div>
        <div style="display:grid; grid-template-columns:1.3fr 0.7fr; gap:18px; min-height:260px;">
          <div style="border-radius:18px; background:linear-gradient(135deg, rgba(37,99,235,0.45), rgba(244,114,182,0.28)); border:1px solid rgba(255,255,255,0.12); padding:22px; position:relative; overflow:hidden;">
            <div style="font-size:28px; font-weight:700; color:#f8fafc; margin-bottom:12px;">Annotation Playground</div>
            <div style="font-size:15px; color:#dbeafe; max-width:420px; line-height:1.65;">Use this preview as the first-click entry point for the actual annotation canvas story.</div>
            <div style="position:absolute; left:22px; right:22px; bottom:24px; height:10px; border-radius:999px; background:rgba(255,255,255,0.15);"></div>
            <div style="position:absolute; right:30px; top:30px; width:84px; height:84px; border-radius:999px; background:rgba(250,204,21,0.85);"></div>
          </div>
          <div style="display:grid; gap:16px;">
            <div style="border-radius:18px; padding:18px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#cbd5e1;">
              <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.14em; color:#f9a8d4; margin-bottom:10px;">Checks</div>
              <div style="line-height:1.7;">Contrast, spacing, and edge treatment should all be easy to compare between presets.</div>
            </div>
            <div style="border-radius:18px; padding:18px; background:rgba(15,23,42,0.62); border:1px solid rgba(255,255,255,0.1); color:#bfdbfe; line-height:1.7;">
              Draw on the canvas, then test undo, cancel, and complete before switching presets.
            </div>
          </div>
        </div>
      </div>
    </article>
    <div style="padding:18px; border-radius:20px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); color:#cbd5e1;">
      <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#f9a8d4; margin-bottom:12px;">Checklist</div>
      <ul style="margin:0; padding-left:18px; line-height:1.8;">
        <li>Check toolbar shape, contrast, and edge treatment</li>
        <li>Draw, undo, cancel, and complete to verify control hierarchy</li>
        <li>Compare this story against other presets for rhythm and readability</li>
      </ul>
    </div>
  `;

  const target = section.querySelector(
    "#annotation-target",
  ) as HTMLElement | null;
  if (target) {
    target.addEventListener("mouseenter", () => {
      target.style.transform = "translateY(-2px)";
      target.style.boxShadow = "0 20px 50px rgba(15,23,42,0.25)";
    });
    target.addEventListener("mouseleave", () => {
      target.style.transform = "translateY(0)";
      target.style.boxShadow = "none";
    });
    target.addEventListener("click", async () => {
      await openAnnotationStory(preset);
    });
  }

  root.appendChild(section);

  requestAnimationFrame(() => {
    if (hasAutoOpened) {
      return;
    }
    hasAutoOpened = true;
    void openAnnotationStory(preset);
  });

  return root;
}

export const Modern: Story = {
  render: () =>
    renderAnnotationLaunch(
      "modern",
      "Modern annotation canvas",
      "The current default direction, isolated so you can inspect the toolbar and canvas shell without live app state.",
    ),
};

export const Windows90s: Story = {
  render: () =>
    renderAnnotationLaunch(
      "windows90s",
      "Windows 90s annotation canvas",
      "A classic desktop-inspired preset that turns the canvas chrome into something closer to a legacy system utility, making hierarchy and edge treatment easier to judge.",
    ),
};

export const Terminal: Story = {
  render: () =>
    renderAnnotationLaunch(
      "terminal",
      "Terminal annotation canvas",
      "A stripped-down preset that makes it easier to judge whether the tool chrome should disappear into the background.",
    ),
};

export const GitHubLight: Story = {
  render: () =>
    renderAnnotationLaunch(
      "githubLight",
      "GitHub Light annotation canvas",
      "A crisp light preset that makes border weight, control grouping, and white-surface contrast easier to evaluate against the screenshot.",
    ),
};

export const Dracula: Story = {
  render: () =>
    renderAnnotationLaunch(
      "dracula",
      "Dracula annotation canvas",
      "A vivid dark preset that exaggerates accent emphasis so you can judge whether the toolbar benefits from a more expressive palette.",
    ),
};

export const Nord: Story = {
  render: () =>
    renderAnnotationLaunch(
      "nord",
      "Nord annotation canvas",
      "A muted cool preset that keeps the toolbar calm while preserving enough contrast to compare drawing controls at a glance.",
    ),
};
