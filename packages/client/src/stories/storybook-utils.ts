import { showAnnotationCanvas } from '../annotation.js'
import { dismissFeedbackDialog, initFeedback, showFeedbackDialog } from '../feedback.js'
import type { ResolvedConfig } from '../types.js'
import { type SnapfeedStylePreset, setSnapfeedStylePreset } from '../ui-theme.js'

export type StoryPreset = SnapfeedStylePreset

function createSvgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}

async function createJpegFixture(markup: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Unable to create canvas context for Storybook fixture'))
        return
      }
      ctx.drawImage(image, 0, 0)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      const base64 = dataUrl.split(',')[1]
      if (!base64) {
        reject(new Error('Unable to encode Storybook fixture as base64 JPEG'))
        return
      }
      resolve(base64)
    }
    image.onerror = () => reject(new Error('Unable to load Storybook annotation fixture'))
    image.src = createSvgDataUrl(markup)
  })
}

export function cleanupStorySurface(): void {
  dismissFeedbackDialog()
  document.querySelectorAll('[data-snapfeed-overlay]').forEach((node) => {
    node.remove()
  })
}

export function renderStoryShell(title: string, subtitle: string): HTMLDivElement {
  cleanupStorySurface()

  const root = document.createElement('div')
  root.style.cssText = `
    min-height: 100vh;
    padding: 40px;
    box-sizing: border-box;
    background:
      radial-gradient(circle at top left, rgba(255,255,255,0.08), transparent 30%),
      linear-gradient(135deg, #0f172a 0%, #111827 45%, #1f2937 100%);
    color: #f8fafc;
    font-family: 'Avenir Next', 'Segoe UI', sans-serif;
  `

  const header = document.createElement('div')
  header.style.cssText = 'max-width: 960px; margin: 0 auto 24px;'
  header.innerHTML = `
    <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#93c5fd; margin-bottom:12px;">Snapfeed UI Lab</div>
    <h1 style="margin:0 0 8px; font-size:36px; line-height:1.05; font-weight:700;">${title}</h1>
    <p style="margin:0; max-width:680px; font-size:16px; line-height:1.6; color:#cbd5e1;">${subtitle}</p>
  `
  root.appendChild(header)

  return root
}

export function createFixtureCard(): HTMLDivElement {
  const fixture = document.createElement('div')
  fixture.style.cssText = `
    max-width: 960px;
    margin: 0 auto;
    display: grid;
    gap: 20px;
    grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
  `
  fixture.innerHTML = `
    <section style="padding:28px; border-radius:24px; background:rgba(15,23,42,0.82); border:1px solid rgba(148,163,184,0.18); box-shadow:0 24px 70px rgba(15,23,42,0.4);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:20px; margin-bottom:28px;">
        <div>
          <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#fca5a5; margin-bottom:10px;">Canvas Target</div>
          <h2 style="margin:0 0 10px; font-size:30px;">Search result card</h2>
          <p style="margin:0; max-width:520px; color:#94a3b8; line-height:1.6;">The feedback overlay opens as soon as the story renders. If you dismiss it and want to inspect again, click the card to reopen it. The overlay now exposes attachment controls, clearer loading states, and explicit submission feedback alongside the existing label and breadcrumb context.</p>
        </div>
        <div style="padding:10px 14px; border-radius:999px; background:rgba(251,113,133,0.12); color:#fecdd3; font-size:12px; text-transform:uppercase; letter-spacing:0.14em; white-space:nowrap;">Auto-open on load</div>
      </div>
      <article id="feedback-target" data-feedback-context="search-results" data-index="7" aria-label="Revamp annotation toolbar card" style="padding:24px; border-radius:22px; background:linear-gradient(145deg, rgba(30,41,59,0.96), rgba(15,23,42,0.96)); border:1px solid rgba(251,113,133,0.2); display:grid; gap:16px; cursor:pointer; transition:transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease; box-shadow:0 0 0 rgba(0,0,0,0);">
        <div style="display:flex; justify-content:space-between; gap:16px; align-items:flex-start;">
          <div>
            <div style="font-size:13px; color:#fca5a5; margin-bottom:10px;">Result 07</div>
            <h3 style="margin:0 0 10px; font-size:24px;">Revamp annotation toolbar</h3>
            <p style="margin:0; color:#cbd5e1; line-height:1.6;">Add style presets that make it easy to compare a retro 90s chrome against a sharp modern interface without touching the behavior layer.</p>
          </div>
          <div style="padding:8px 10px; border-radius:999px; background:rgba(56,189,248,0.15); color:#7dd3fc; font-size:12px; white-space:nowrap;">High impact</div>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:10px;">
          <span style="padding:6px 10px; border-radius:999px; background:rgba(250,204,21,0.12); color:#fde68a; font-size:12px;">Toolbar</span>
          <span style="padding:6px 10px; border-radius:999px; background:rgba(52,211,153,0.12); color:#a7f3d0; font-size:12px;">Canvas</span>
          <span style="padding:6px 10px; border-radius:999px; background:rgba(192,132,252,0.12); color:#d8b4fe; font-size:12px;">Theme presets</span>
        </div>
      </article>
    </section>
    <aside style="padding:24px; border-radius:24px; background:rgba(15,23,42,0.68); border:1px solid rgba(148,163,184,0.16); box-shadow:0 24px 60px rgba(15,23,42,0.3);">
      <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.18em; color:#86efac; margin-bottom:12px;">How to use</div>
      <ol style="margin:0; padding-left:18px; color:#cbd5e1; line-height:1.8;">
        <li>The current feedback preset opens automatically when the story loads.</li>
        <li>Use the attachment controls to toggle screenshot and page context before sending.</li>
        <li>Use the annotate button in the overlay after the screenshot is ready.</li>
        <li>Dismiss and click the result card only if you want to reopen it.</li>
      </ol>
    </aside>
  `

  const target = fixture.querySelector('#feedback-target') as HTMLElement | null
  if (target) {
    target.addEventListener('mouseenter', () => {
      target.style.transform = 'translateY(-2px)'
      target.style.borderColor = 'rgba(251,113,133,0.5)'
      target.style.boxShadow = '0 18px 48px rgba(15,23,42,0.35)'
    })
    target.addEventListener('mouseleave', () => {
      target.style.transform = 'translateY(0)'
      target.style.borderColor = 'rgba(251,113,133,0.2)'
      target.style.boxShadow = '0 0 0 rgba(0,0,0,0)'
    })
  }

  return fixture
}

export function configureFeedbackStory(preset: StoryPreset, config: ResolvedConfig): void {
  initFeedback(config)
  setSnapfeedStylePreset(preset)
}

export function openFeedbackForFixture(target: Element): void {
  const rect = target.getBoundingClientRect()
  showFeedbackDialog(target, rect.left + rect.width / 2, rect.top + 28)
}

export async function openAnnotationStory(preset: StoryPreset): Promise<void> {
  cleanupStorySurface()
  setSnapfeedStylePreset(preset)

  const screenshot = await createJpegFixture(
    `
    <svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="55%" stop-color="#1d4ed8" />
          <stop offset="100%" stop-color="#fb7185" />
        </linearGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#bg)" rx="40" />
      <rect x="80" y="100" width="760" height="610" rx="36" fill="rgba(15,23,42,0.78)" stroke="rgba(255,255,255,0.16)" />
      <rect x="900" y="130" width="420" height="240" rx="28" fill="rgba(255,255,255,0.12)" />
      <rect x="900" y="410" width="420" height="260" rx="28" fill="rgba(15,23,42,0.38)" stroke="rgba(255,255,255,0.16)" />
      <text x="130" y="190" font-size="64" font-family="Arial, sans-serif" fill="#f8fafc">Annotation Playground</text>
      <text x="130" y="260" font-size="28" font-family="Arial, sans-serif" fill="#bfdbfe">Use this canvas to compare chrome styles without changing drawing behavior.</text>
      <circle cx="1090" cy="250" r="82" fill="#facc15" opacity="0.82" />
      <path d="M180 430 C 340 320, 470 540, 680 440" stroke="#22d3ee" stroke-width="20" fill="none" stroke-linecap="round" />
      <path d="M180 520 C 340 410, 470 630, 680 530" stroke="#ffffff" stroke-opacity="0.45" stroke-width="10" fill="none" stroke-linecap="round" />
      <text x="930" y="470" font-size="38" font-family="Arial, sans-serif" fill="#f8fafc">Preset Focus</text>
      <text x="930" y="525" font-size="24" font-family="Arial, sans-serif" fill="#e2e8f0">Toolbar framing</text>
      <text x="930" y="565" font-size="24" font-family="Arial, sans-serif" fill="#e2e8f0">Contrast and emphasis</text>
      <text x="930" y="605" font-size="24" font-family="Arial, sans-serif" fill="#e2e8f0">Button rhythm and edge treatment</text>
    </svg>
  `,
    0.9,
  )

  await showAnnotationCanvas(screenshot, 0.9)
}
