import type { Meta, StoryObj } from '@storybook/html'
import { createFeedbackController } from '../feedback.js'
import { initSnapfeed } from '../index.js'
import type { FeedbackCategory, FeedbackController, FeedbackTrigger } from '../types.js'
import { resolveConfig } from '../types.js'
import {
  cleanupStorySurface,
  configureFeedbackStory,
  createFixtureCard,
  openFeedbackForFixture,
  renderStoryShell,
  type StoryPreset,
} from './storybook-utils.js'

const meta = {
  title: 'Snapfeed/Feedback Overlay',
} satisfies Meta

export default meta

type Story = StoryObj

const CUSTOM_CATEGORY_META: Array<{
  id: FeedbackCategory
  label: string
  tone: string
}> = [
  { id: 'bug', label: 'Bug', tone: '#f97316' },
  { id: 'idea', label: 'Idea', tone: '#0284c7' },
  { id: 'question', label: 'Question', tone: '#7c3aed' },
  { id: 'praise', label: 'Praise', tone: '#059669' },
  { id: 'other', label: 'Other', tone: '#475569' },
]

let activeStoryTeardown: (() => void) | null = null

function resetStoryRuntime(): void {
  activeStoryTeardown?.()
  activeStoryTeardown = null
}

function createCustomPanelCleanup(): () => void {
  document.querySelector('[data-snapfeed-overlay="custom-feedback-panel"]')?.remove()
  return () => {
    document.querySelector('[data-snapfeed-overlay="custom-feedback-panel"]')?.remove()
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getCustomStatusAppearance(
  snapshot: FeedbackController['getSnapshot'] extends () => infer T ? T : never,
): {
  eyebrow: string
  message: string
  background: string
  borderColor: string
  textColor: string
} {
  if (snapshot.submitState.kind === 'complete') {
    return {
      eyebrow: 'Sent',
      message: snapshot.submitState.message,
      background: 'rgba(16, 185, 129, 0.12)',
      borderColor: 'rgba(16, 185, 129, 0.22)',
      textColor: '#065f46',
    }
  }

  if (snapshot.submitState.kind === 'submitting') {
    return {
      eyebrow: 'Delivery',
      message:
        snapshot.includeScreenshot && snapshot.screenshotState === 'pending'
          ? 'Finishing the screenshot before delivery.'
          : 'Sending feedback through the controller.',
      background: 'rgba(14, 165, 233, 0.1)',
      borderColor: 'rgba(14, 165, 233, 0.22)',
      textColor: '#0f172a',
    }
  }

  if (snapshot.screenshotState === 'pending' && snapshot.includeScreenshot) {
    return {
      eyebrow: 'Capture',
      message: 'Preparing screenshot in the background while you write.',
      background: 'rgba(59, 130, 246, 0.08)',
      borderColor: 'rgba(59, 130, 246, 0.18)',
      textColor: '#1e3a8a',
    }
  }

  if (snapshot.screenshotState === 'ready' && snapshot.includeScreenshot) {
    return {
      eyebrow: 'Ready',
      message: 'Screenshot is attached and the payload is ready to inspect.',
      background: 'rgba(251, 191, 36, 0.12)',
      borderColor: 'rgba(251, 191, 36, 0.24)',
      textColor: '#854d0e',
    }
  }

  return {
    eyebrow: 'Text only',
    message: 'This report will be sent without a screenshot attachment.',
    background: 'rgba(100, 116, 139, 0.09)',
    borderColor: 'rgba(100, 116, 139, 0.18)',
    textColor: '#334155',
  }
}

function getCustomPanelLayout(): {
  isCompact: boolean
  isNarrow: boolean
  shellStyle: string
  headerStyle: string
  targetGridStyle: string
  toggleGridStyle: string
  actionStyle: string
  footerStyle: string
  payloadHeight: string
} {
  const isCompact = window.innerWidth <= 900
  const isNarrow = window.innerWidth <= 640

  return {
    isCompact,
    isNarrow,
    shellStyle: isNarrow
      ? `
          position: fixed;
          inset: 12px;
          width: auto;
          max-height: calc(100vh - 24px);
          padding: 16px;
          border-radius: 26px;
        `
      : isCompact
        ? `
            position: fixed;
            right: 14px;
            top: 14px;
            width: min(420px, calc(100vw - 28px));
            max-height: calc(100vh - 28px);
            padding: 18px;
            border-radius: 28px;
          `
        : `
            position: fixed;
            right: 18px;
            top: 18px;
            width: min(468px, calc(100vw - 36px));
            max-height: calc(100vh - 36px);
            padding: 22px;
            border-radius: 32px;
          `,
    headerStyle: isNarrow
      ? 'display:grid; gap:14px;'
      : 'display:flex; justify-content:space-between; align-items:flex-start; gap:18px;',
    targetGridStyle: isCompact
      ? 'display:grid; gap:12px; grid-template-columns:minmax(0, 1fr);'
      : 'display:grid; gap:14px; grid-template-columns:minmax(0, 1.35fr) minmax(132px, 0.75fr);',
    toggleGridStyle: isNarrow
      ? 'display:grid; gap:10px; grid-template-columns:minmax(0, 1fr);'
      : 'display:grid; gap:10px; grid-template-columns:repeat(2, minmax(0, 1fr));',
    actionStyle: isNarrow
      ? 'display:grid; gap:10px; grid-template-columns:minmax(0, 1fr); padding-top:2px;'
      : 'display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; padding-top:2px;',
    footerStyle: isNarrow
      ? 'font-size:11px; line-height:1.6; color:#64748b; text-align:left;'
      : 'font-size:11px; line-height:1.6; color:#64748b; text-align:right;',
    payloadHeight: isNarrow ? '180px' : '220px',
  }
}

function mountCustomFeedbackPanel(controller: FeedbackController): void {
  const clearPanel = createCustomPanelCleanup()
  const panel = document.createElement('section')
  panel.dataset.snapfeedOverlay = 'custom-feedback-panel'
  panel.style.cssText = `
    position: fixed;
    overflow: auto;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background:
      radial-gradient(circle at top right, rgba(56, 189, 248, 0.2), transparent 34%),
      radial-gradient(circle at bottom left, rgba(251, 146, 60, 0.16), transparent 32%),
      linear-gradient(180deg, rgba(255, 251, 245, 0.98), rgba(239, 246, 255, 0.96));
    box-shadow:
      0 30px 90px rgba(15, 23, 42, 0.26),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
    color: #14213d;
    font-family: 'Avenir Next', 'Segoe UI', sans-serif;
    z-index: 100001;
    backdrop-filter: blur(18px);
  `
  document.body.appendChild(panel)

  const close = () => {
    unsubscribe()
    window.removeEventListener('resize', handleResize)
    controller.dispose()
    clearPanel()
  }

  const render = () => {
    const snapshot = controller.getSnapshot()
    const layout = getCustomPanelLayout()
    const annotateDisabled =
      snapshot.submitState.kind !== 'idle' ||
      !snapshot.includeScreenshot ||
      snapshot.screenshotState !== 'ready'
    const sendDisabled = snapshot.submitState.kind === 'submitting' || !snapshot.text.trim()
    const statusAppearance = getCustomStatusAppearance(snapshot)
    const payloadPreview = escapeHtml(JSON.stringify(controller.getPayloadPreview(), null, 2))
    const targetLabel = escapeHtml(snapshot.targetLabel)
    const breadcrumb = escapeHtml(snapshot.breadcrumb)
    const textValue = escapeHtml(snapshot.text)

    panel.style.cssText = `
      ${layout.shellStyle}
      overflow: auto;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background:
        radial-gradient(circle at top right, rgba(56, 189, 248, 0.2), transparent 34%),
        radial-gradient(circle at bottom left, rgba(251, 146, 60, 0.16), transparent 32%),
        linear-gradient(180deg, rgba(255, 251, 245, 0.98), rgba(239, 246, 255, 0.96));
      box-shadow:
        0 30px 90px rgba(15, 23, 42, 0.26),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
      color: #14213d;
      font-family: 'Avenir Next', 'Segoe UI', sans-serif;
      z-index: 100001;
      backdrop-filter: blur(18px);
    `

    panel.innerHTML = `
      <div style="display:grid; gap:16px;">
        <div style="${layout.headerStyle}">
          <div>
            <div style="display:inline-flex; align-items:center; gap:8px; padding:8px 12px; border-radius:999px; background:rgba(255,255,255,0.72); border:1px solid rgba(14,165,233,0.16); color:#0284c7; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; margin-bottom:12px; box-shadow:0 10px 24px rgba(255,255,255,0.42);">Bring your own UI</div>
            <h2 style="margin:0 0 10px; font-size:${layout.isNarrow ? '27px' : '31px'}; line-height:0.98; letter-spacing:-0.03em; color:#172554;">Custom feedback overlay</h2>
            <p style="margin:0; max-width:${layout.isNarrow ? 'none' : '32ch'}; color:#475569; line-height:1.65; font-size:14px;">This panel is not Snapfeed's default dialog. It is a custom editorial-style surface mounted on top of the headless feedback controller.</p>
          </div>
          <button type="button" id="__sf_custom_close" style="width:40px; height:40px; border-radius:999px; border:1px solid rgba(100,116,139,0.16); background:rgba(255,255,255,0.64); color:#64748b; cursor:pointer; font-size:22px; line-height:1; padding:0; box-shadow:0 8px 24px rgba(148,163,184,0.16); ${layout.isNarrow ? 'justify-self:start;' : ''}">✕</button>
        </div>
        <div style="${layout.targetGridStyle}">
          <div style="padding:16px; border-radius:24px; background:linear-gradient(180deg, rgba(224,242,254,0.84), rgba(255,255,255,0.7)); border:1px solid rgba(56,189,248,0.18); box-shadow:inset 0 1px 0 rgba(255,255,255,0.56);">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#0c4a6e; margin-bottom:10px;">Target</div>
            <div style="font-size:15px; font-weight:700; line-height:1.4; margin-bottom:6px; color:#0f172a;">${targetLabel}</div>
            <div style="font-size:13px; color:#475569; line-height:1.55;">${breadcrumb}</div>
          </div>
          <div style="padding:16px; border-radius:24px; background:linear-gradient(180deg, rgba(255,255,255,0.86), rgba(248,250,252,0.86)); border:1px solid rgba(148,163,184,0.18); display:grid; align-content:space-between; gap:10px;">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#64748b;">Snapshot</div>
            <div>
              <div style="font-size:28px; line-height:1; font-weight:700; letter-spacing:-0.04em; color:#0f172a;">${snapshot.screenshotState === 'ready' ? '01' : snapshot.screenshotState === 'pending' ? '00' : '--'}</div>
              <div style="margin-top:8px; font-size:12px; line-height:1.55; color:#475569;">${snapshot.includeScreenshot ? 'Screen attached' : 'Text only'}</div>
            </div>
          </div>
        </div>
        <div style="display:grid; gap:10px;">
          <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#64748b;">Signal</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${CUSTOM_CATEGORY_META.map((category) => {
            const isActive = snapshot.category === category.id
            return `<button type="button" data-custom-cat="${category.id}" style="padding:8px 13px; border-radius:999px; border:1px solid ${isActive ? category.tone : 'rgba(148,163,184,0.28)'}; background:${isActive ? `${category.tone}18` : 'rgba(255,255,255,0.82)'}; color:${isActive ? '#0f172a' : '#334155'}; cursor:pointer; font-size:12px; font-weight:${isActive ? '700' : '500'}; box-shadow:${isActive ? '0 10px 24px rgba(15,23,42,0.08)' : 'none'};">${category.label}</button>`
          }).join('')}
          </div>
        </div>
        <div style="padding:16px; border-radius:26px; background:linear-gradient(180deg, rgba(255,255,255,0.88), rgba(248,250,252,0.88)); border:1px solid rgba(148,163,184,0.16); box-shadow:inset 0 1px 0 rgba(255,255,255,0.56);">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px;">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#64748b;">Narrative</div>
            <div style="font-size:12px; color:#64748b;">${snapshot.text.trim().length} chars</div>
          </div>
          <textarea id="__sf_custom_text" rows="5" style="width:100%; box-sizing:border-box; resize:vertical; min-height:${layout.isNarrow ? '112px' : '138px'}; border-radius:22px; border:1px solid rgba(125,211,252,0.24); background:rgba(255,255,255,0.94); color:#0f172a; padding:${layout.isNarrow ? '14px' : '16px'}; font-size:${layout.isNarrow ? '14px' : '15px'}; line-height:1.6; font-family:inherit; box-shadow:inset 0 1px 0 rgba(255,255,255,0.76);" placeholder="Describe the change you want to make.">${textValue}</textarea>
        </div>
        <div style="${layout.toggleGridStyle}">
          <label style="display:grid; gap:6px; padding:14px 15px; border-radius:22px; background:${snapshot.includeScreenshot ? 'rgba(14,165,233,0.1)' : 'rgba(15,23,42,0.04)'}; border:1px solid ${snapshot.includeScreenshot ? 'rgba(14,165,233,0.22)' : 'rgba(148,163,184,0.14)'}; color:#1e293b; font-size:13px; cursor:pointer;">
            <span style="display:flex; align-items:center; gap:10px; font-weight:600;">
              <input id="__sf_custom_screenshot" type="checkbox" ${snapshot.includeScreenshot ? 'checked' : ''} ${snapshot.submitState.kind !== 'idle' || snapshot.screenshotState === 'unavailable' ? 'disabled' : ''} />
              <span>Attach screenshot</span>
            </span>
            <span style="font-size:12px; line-height:1.5; color:#475569;">${snapshot.screenshotState === 'ready' ? 'Ready for annotation or send.' : snapshot.screenshotState === 'pending' ? 'Captured in the background.' : 'Unavailable in this surface.'}</span>
          </label>
          <label style="display:grid; gap:6px; padding:14px 15px; border-radius:22px; background:${snapshot.includeContext ? 'rgba(249,115,22,0.08)' : 'rgba(15,23,42,0.04)'}; border:1px solid ${snapshot.includeContext ? 'rgba(249,115,22,0.2)' : 'rgba(148,163,184,0.14)'}; color:#1e293b; font-size:13px; cursor:pointer;">
            <span style="display:flex; align-items:center; gap:10px; font-weight:600;">
              <input id="__sf_custom_context" type="checkbox" ${snapshot.includeContext ? 'checked' : ''} ${snapshot.submitState.kind !== 'idle' ? 'disabled' : ''} />
              <span>Attach context</span>
            </span>
            <span style="font-size:12px; line-height:1.5; color:#475569;">Include DOM context, labels, and page-level detail in the report.</span>
          </label>
        </div>
        <div style="padding:16px; border-radius:26px; background:rgba(255,255,255,0.52); border:1px solid ${statusAppearance.borderColor}; box-shadow:inset 0 1px 0 rgba(255,255,255,0.65);">
          <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:${statusAppearance.textColor}; margin-bottom:8px;">${statusAppearance.eyebrow}</div>
          <div id="__sf_custom_status" style="color:${statusAppearance.textColor}; font-size:14px; line-height:1.6;">${statusAppearance.message}</div>
        </div>
        <div style="padding:16px; border-radius:26px; background:linear-gradient(180deg, rgba(15,23,42,0.92), rgba(15,23,42,0.86)); border:1px solid rgba(148,163,184,0.14); color:#e2e8f0; box-shadow:0 18px 40px rgba(15,23,42,0.2);">
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:10px;">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#93c5fd;">Payload Preview</div>
            <div style="display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,0.06); color:#cbd5e1; font-size:11px; text-transform:uppercase; letter-spacing:0.08em;">${snapshot.screenshotState}</div>
          </div>
          <pre style="margin:0; max-height:${layout.payloadHeight}; overflow:auto; padding:14px; border-radius:18px; background:rgba(2,6,23,0.42); border:1px solid rgba(148,163,184,0.12); white-space:pre-wrap; word-break:break-word; font-size:11px; line-height:1.65; color:#e2e8f0;">${payloadPreview}</pre>
        </div>
        <div style="${layout.actionStyle}">
          <button type="button" id="__sf_custom_annotate" ${annotateDisabled ? 'disabled' : ''} style="padding:11px 15px; border-radius:999px; border:1px solid rgba(14,165,233,0.2); background:rgba(255,255,255,0.72); color:#0f172a; cursor:${annotateDisabled ? 'not-allowed' : 'pointer'}; opacity:${annotateDisabled ? '0.55' : '1'}; font-size:12px; font-weight:600; box-shadow:0 10px 24px rgba(148,163,184,0.14); width:${layout.isNarrow ? '100%' : 'auto'};">Annotate</button>
          <button type="button" id="__sf_custom_send" ${sendDisabled ? 'disabled' : ''} style="padding:11px 18px; border-radius:999px; border:none; background:linear-gradient(135deg, #0f172a, #1d4ed8); color:#f8fafc; cursor:${sendDisabled ? 'not-allowed' : 'pointer'}; opacity:${sendDisabled ? '0.55' : '1'}; font-size:12px; font-weight:700; letter-spacing:0.02em; box-shadow:0 14px 34px rgba(29,78,216,0.22); width:${layout.isNarrow ? '100%' : 'auto'};">${snapshot.submitState.kind === 'complete' ? 'Close' : snapshot.submitState.kind === 'submitting' ? 'Sending...' : 'Send feedback'}</button>
        </div>
        <div style="${layout.footerStyle}">This surface is entirely custom. The controller still owns capture, preview, and submit.</div>
        </div>
      </div>
    `

    panel.querySelector<HTMLButtonElement>('#__sf_custom_close')?.addEventListener('click', close)
    panel
      .querySelector<HTMLTextAreaElement>('#__sf_custom_text')
      ?.addEventListener('input', (event) => {
        controller.setText((event.currentTarget as HTMLTextAreaElement).value)
      })
    panel.querySelectorAll<HTMLButtonElement>('button[data-custom-cat]').forEach((button) => {
      button.addEventListener('click', () => {
        controller.setCategory(button.dataset.customCat as FeedbackCategory)
      })
    })
    panel
      .querySelector<HTMLInputElement>('#__sf_custom_screenshot')
      ?.addEventListener('change', (event) => {
        controller.setIncludeScreenshot((event.currentTarget as HTMLInputElement).checked)
      })
    panel
      .querySelector<HTMLInputElement>('#__sf_custom_context')
      ?.addEventListener('change', (event) => {
        controller.setIncludeContext((event.currentTarget as HTMLInputElement).checked)
      })
    panel
      .querySelector<HTMLButtonElement>('#__sf_custom_annotate')
      ?.addEventListener('click', () => {
        void controller.annotate()
      })
    panel.querySelector<HTMLButtonElement>('#__sf_custom_send')?.addEventListener('click', () => {
      if (snapshot.submitState.kind === 'complete') {
        close()
        return
      }
      void controller.submit()
    })
  }

  const handleResize = () => {
    render()
  }

  window.addEventListener('resize', handleResize)
  const unsubscribe = controller.subscribe(render)
  render()
}

function openCustomFeedback(
  target: Element,
  onTrigger: (controller: FeedbackController, trigger: FeedbackTrigger) => void,
): void {
  const rect = target.getBoundingClientRect()
  const trigger = {
    element: target,
    x: rect.left + rect.width / 2,
    y: rect.top + 28,
  }
  const controller = createFeedbackController(trigger)
  onTrigger(controller, trigger)
}

function renderFeedbackPreset(
  preset: StoryPreset,
  title: string,
  subtitle: string,
): HTMLDivElement {
  resetStoryRuntime()
  let hasAutoOpened = false
  const root = renderStoryShell(title, subtitle)
  const fixture = createFixtureCard()
  root.appendChild(fixture)

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
        name: 'Storybook Preview',
        email: 'preview@snapfeed.dev',
      },
    }),
  )

  const target = fixture.querySelector('#feedback-target')
  if (target) {
    target.addEventListener('click', () => openFeedbackForFixture(target))

    requestAnimationFrame(() => {
      if (hasAutoOpened) {
        return
      }
      hasAutoOpened = true
      openFeedbackForFixture(target)
    })
  }

  return root
}

function renderCustomFeedbackPreset(
  preset: StoryPreset,
  title: string,
  subtitle: string,
): HTMLDivElement {
  resetStoryRuntime()
  let hasAutoOpened = false
  cleanupStorySurface()
  const root = renderStoryShell(title, subtitle)
  const fixture = createFixtureCard()
  root.appendChild(fixture)

  const onTrigger = (controller: FeedbackController) => {
    mountCustomFeedbackPanel(controller)
  }

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
        name: 'Storybook Preview',
        email: 'preview@snapfeed.dev',
      },
    }),
  )

  const target = fixture.querySelector('#feedback-target')
  const aside = fixture.querySelector('aside')

  if (aside) {
    aside.innerHTML = `
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#86efac; margin-bottom:12px;">Custom UI flow</div>
      <ol style="margin:0; padding-left:18px; color:#cbd5e1; line-height:1.8;">
        <li>The card still provides the target element and click anchor.</li>
        <li>The Storybook panel on the right is mounted by your own callback.</li>
        <li>The payload preview and submit actions come from the controller.</li>
        <li>You can close and reopen the panel by clicking the result card again.</li>
      </ol>
    `
  }

  if (target) {
    target.addEventListener('click', () => openCustomFeedback(target, onTrigger))

    requestAnimationFrame(() => {
      if (hasAutoOpened) return
      hasAutoOpened = true
      openCustomFeedback(target, onTrigger)
    })
  }

  return root
}

function dispatchCustomTrigger(target: Element): void {
  const rect = target.getBoundingClientRect()
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + 28,
    }),
  )
}

function renderCustomFeedbackInitPreset(title: string, subtitle: string): HTMLDivElement {
  resetStoryRuntime()
  let hasAutoOpened = false
  cleanupStorySurface()
  const root = renderStoryShell(title, subtitle)
  const fixture = createFixtureCard()
  root.appendChild(fixture)

  const onTrigger = (controller: FeedbackController) => {
    mountCustomFeedbackPanel(controller)
  }

  activeStoryTeardown = initSnapfeed({
    endpoint: '/api/storybook-feedback',
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
      name: 'Storybook Preview',
      email: 'preview@snapfeed.dev',
    },
  })

  const aside = fixture.querySelector('aside')
  if (aside) {
    aside.innerHTML = `
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#86efac; margin-bottom:12px;">Config-driven flow</div>
      <ol style="margin:0; padding-left:18px; color:#cbd5e1; line-height:1.8;">
        <li>This story boots Snapfeed through <code>initSnapfeed</code>.</li>
        <li>The target card fires a real Cmd-click style trigger event.</li>
        <li><code>feedback.onTrigger</code> swaps the stock dialog for the custom panel.</li>
        <li>The controller still owns screenshot capture, payload preview, and submit.</li>
      </ol>
    `
  }

  const target = fixture.querySelector('#feedback-target')
  if (target) {
    target.addEventListener('click', (event) => {
      if ((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey) {
        return
      }
      dispatchCustomTrigger(target)
    })

    requestAnimationFrame(() => {
      if (hasAutoOpened) return
      hasAutoOpened = true
      dispatchCustomTrigger(target)
    })
  }

  return root
}

export const Modern: Story = {
  render: () =>
    renderFeedbackPreset(
      'modern',
      'Modern feedback overlay',
      'A clean default treatment that keeps the current Snapfeed feel but exposes it as a visual surface you can tune.',
    ),
}

export const Windows90s: Story = {
  render: () =>
    renderFeedbackPreset(
      'windows90s',
      'Windows 90s feedback overlay',
      'Classic desktop chrome with hard edges, system-font density, and high-contrast framing so you can judge whether the interaction benefits from a more literal operating-system feel.',
    ),
}

export const Terminal: Story = {
  render: () =>
    renderFeedbackPreset(
      'terminal',
      'Terminal feedback overlay',
      'A utilitarian preset that shows how the same interaction reads with monospaced typography and flatter chrome.',
    ),
}

export const GitHubLight: Story = {
  render: () =>
    renderFeedbackPreset(
      'githubLight',
      'GitHub Light feedback overlay',
      'A familiar light preset with restrained borders and clearer daylight contrast for teams that prefer product UI chrome over modal-heavy dark surfaces.',
    ),
}

export const Dracula: Story = {
  render: () =>
    renderFeedbackPreset(
      'dracula',
      'Dracula feedback overlay',
      'A high-recognition editor-inspired preset with saturated accent treatment, useful for checking whether stronger emphasis improves action hierarchy.',
    ),
}

export const Nord: Story = {
  render: () =>
    renderFeedbackPreset(
      'nord',
      'Nord feedback overlay',
      'A cooler slate preset that keeps the interface subdued while preserving clearer structure than the terminal treatment.',
    ),
}

export const CustomUi: Story = {
  render: () =>
    renderCustomFeedbackPreset(
      'modern',
      'Custom feedback overlay',
      'A bring-your-own UI example that keeps Snapfeed capture, screenshot, queueing, and payload generation while replacing the default dialog with a bespoke panel.',
    ),
}

export const CustomUiViaInit: Story = {
  render: () =>
    renderCustomFeedbackInitPreset(
      'Config-driven custom feedback overlay',
      'A full init path example that uses initSnapfeed and feedback.onTrigger to intercept Cmd-click feedback and mount a custom UI surface.',
    ),
}
