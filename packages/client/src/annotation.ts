/**
 * Annotation canvas — draw on screenshots before submitting feedback.
 * Pure DOM implementation (no React dependency).
 * Tools: pen, rectangle, arrow, highlighter.
 */

import { getSnapfeedTheme } from './ui-theme.js'

type AnnotationTool = 'pen' | 'rect' | 'arrow' | 'highlighter'

interface Point {
  x: number
  y: number
}

interface Stroke {
  tool: AnnotationTool
  color: string
  lineWidth: number
  points: Point[]
  start?: Point
  end?: Point
}

const TOOLS: Array<{ id: AnnotationTool; emoji: string; title: string }> = [
  { id: 'pen', emoji: '✏️', title: 'Free draw' },
  { id: 'rect', emoji: '⬜', title: 'Rectangle' },
  { id: 'arrow', emoji: '↗', title: 'Arrow' },
  { id: 'highlighter', emoji: '🖊', title: 'Highlighter' },
]

const COLORS = ['#EF4444', '#FBBF24', '#3B82F6', '#FFFFFF', '#111111']

function lineWidth(tool: AnnotationTool): number {
  return tool === 'highlighter' ? 16 : tool === 'pen' ? 2.5 : 3
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.save()
  ctx.strokeStyle = s.color
  ctx.lineWidth = s.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = 0.35
  } else {
    ctx.globalAlpha = 1
  }

  if (s.tool === 'pen' || s.tool === 'highlighter') {
    if (s.points.length < 2) {
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.moveTo(s.points[0].x, s.points[0].y)
    for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y)
    ctx.stroke()
  } else if (s.tool === 'rect' && s.start && s.end) {
    const x = Math.min(s.start.x, s.end.x),
      y = Math.min(s.start.y, s.end.y)
    const w = Math.abs(s.end.x - s.start.x),
      h = Math.abs(s.end.y - s.start.y)
    ctx.strokeRect(x, y, w, h)
  } else if (s.tool === 'arrow' && s.start && s.end) {
    const angle = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x)
    const headLen = Math.max(12, s.lineWidth * 5)
    ctx.beginPath()
    ctx.moveTo(s.start.x, s.start.y)
    ctx.lineTo(s.end.x, s.end.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(s.end.x, s.end.y)
    ctx.lineTo(
      s.end.x - headLen * Math.cos(angle - Math.PI / 7),
      s.end.y - headLen * Math.sin(angle - Math.PI / 7),
    )
    ctx.moveTo(s.end.x, s.end.y)
    ctx.lineTo(
      s.end.x - headLen * Math.cos(angle + Math.PI / 7),
      s.end.y - headLen * Math.sin(angle + Math.PI / 7),
    )
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Show a full-screen annotation overlay on an image.
 * Returns a promise that resolves with the annotated base64 JPEG, or null if cancelled.
 */
export function showAnnotationCanvas(imageBase64: string, quality: number): Promise<string | null> {
  return new Promise((resolve) => {
    const strokes: Stroke[] = []
    let currentStroke: Stroke | null = null
    let activeTool: AnnotationTool = 'pen'
    let activeColor = '#EF4444'
    let drawing = false
    const theme = getSnapfeedTheme()

    // Load image to get dimensions
    const img = new Image()
    img.onload = () => {
      const maxW = window.innerWidth * 0.9,
        maxH = window.innerHeight * 0.75
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
      const displayW = Math.round(img.naturalWidth * scale)
      const displayH = Math.round(img.naturalHeight * scale)

      // Overlay
      const overlay = document.createElement('div')
      overlay.dataset.snapfeedOverlay = 'annotation-canvas'
      overlay.style.cssText = `
        position:fixed; inset:0; z-index:100000; background:${theme.overlayBackdrop};
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:12px; padding:16px; box-sizing:border-box;
        font-family:${theme.fontFamily}; font-size:13px;
      `
      for (const evt of [
        'keydown',
        'keyup',
        'mousedown',
        'mouseup',
        'click',
        'pointerdown',
        'pointerup',
      ]) {
        overlay.addEventListener(evt, (e) => e.stopPropagation())
      }

      // Toolbar
      const toolbar = document.createElement('div')
      toolbar.style.cssText = `
        background:${theme.toolbarBackground}; border:1px solid ${theme.toolbarBorder}; border-radius:${theme.toolbarRadius};
        box-shadow:${theme.toolbarShadow}; color:${theme.panelText};
        padding:8px 12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        max-width:${displayW}px; width:100%; box-sizing:border-box;
      `

      function createBtn(text: string, onClick: () => void, style?: string): HTMLButtonElement {
        const btn = document.createElement('button')
        btn.textContent = text
        btn.style.cssText = `
          height:32px; border-radius:8px; border:2px solid transparent; background:transparent;
          cursor:pointer; font-size:14px; padding:0 8px; color:${theme.buttonText}; font-family:inherit;
          ${style ?? ''}
        `
        btn.onclick = onClick
        return btn
      }

      // Tool buttons
      const toolBtns: HTMLButtonElement[] = []
      for (const t of TOOLS) {
        const btn = createBtn(t.emoji, () => {
          activeTool = t.id
          toolBtns.forEach((b, i) => {
            b.style.border =
              TOOLS[i].id === activeTool ? `2px solid ${theme.accent}` : '2px solid transparent'
            b.style.background = TOOLS[i].id === activeTool ? theme.accentSoft : 'transparent'
          })
        })
        btn.title = t.title
        toolBtns.push(btn)
        toolbar.appendChild(btn)
      }
      toolBtns[0].style.border = `2px solid ${theme.accent}`
      toolBtns[0].style.background = theme.accentSoft

      // Separator
      const sep = () => {
        const d = document.createElement('div')
        d.style.cssText = `width:1px;height:24px;background:${theme.separator};flex-shrink:0;`
        return d
      }
      toolbar.appendChild(sep())

      // Color dots
      for (const c of COLORS) {
        const dot = document.createElement('button')
        dot.style.cssText = `
          width:18px; height:18px; border-radius:50%; border:2px solid ${c === activeColor ? theme.accent : theme.buttonBorder};
          background:${c}; cursor:pointer; padding:0; flex-shrink:0;
        `
        dot.onclick = () => {
          activeColor = c
          toolbar.querySelectorAll<HTMLElement>('[data-color-dot]').forEach((d) => {
            d.style.border = `2px solid ${d.dataset.colorDot === c ? theme.accent : theme.buttonBorder}`
          })
        }
        dot.dataset.colorDot = c
        toolbar.appendChild(dot)
      }

      toolbar.appendChild(sep())

      // Undo
      toolbar.appendChild(
        createBtn(
          '↩ Undo',
          () => {
            strokes.pop()
            redraw()
          },
          `border:1px solid ${theme.buttonBorder};font-size:12px;`,
        ),
      )

      // Spacer
      const spacer = document.createElement('div')
      spacer.style.flex = '1'
      toolbar.appendChild(spacer)

      // Cancel
      toolbar.appendChild(
        createBtn(
          'Cancel',
          () => {
            cleanup()
            resolve(null)
          },
          `border:1px solid ${theme.buttonBorder};font-size:12px;`,
        ),
      )

      // Done
      toolbar.appendChild(
        createBtn(
          '✓ Done',
          () => {
            // Merge image + annotations
            const mergeCanvas = document.createElement('canvas')
            mergeCanvas.width = img.naturalWidth
            mergeCanvas.height = img.naturalHeight
            const mctx = mergeCanvas.getContext('2d')!
            mctx.drawImage(img, 0, 0)
            mctx.drawImage(canvas, 0, 0)
            const dataUrl = mergeCanvas.toDataURL('image/jpeg', quality)
            cleanup()
            resolve(dataUrl.split(',')[1] || null)
          },
          `background:${theme.accent};color:${theme.accentContrast};font-weight:600;font-size:12px;border:none;`,
        ),
      )

      overlay.appendChild(toolbar)

      // Canvas container
      const container = document.createElement('div')
      container.style.cssText = `position:relative;width:${displayW}px;height:${displayH}px;border-radius:${theme.canvasRadius};overflow:hidden;box-shadow:${theme.canvasShadow};`

      // Background image
      const bgImg = document.createElement('img')
      bgImg.src = `data:image/jpeg;base64,${imageBase64}`
      bgImg.draggable = false
      bgImg.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none;'
      container.appendChild(bgImg)

      // Drawing canvas
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none;`
      container.appendChild(canvas)
      overlay.appendChild(container)

      const ctx = canvas.getContext('2d')!

      function getPos(e: MouseEvent | TouchEvent): Point {
        const rect = canvas.getBoundingClientRect()
        const sx = canvas.width / rect.width,
          sy = canvas.height / rect.height
        const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : e.clientX
        const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? 0) : e.clientY
        return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy }
      }

      function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (const s of strokes) drawStroke(ctx, s)
        if (currentStroke) drawStroke(ctx, currentStroke)
      }

      canvas.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const p = getPos(e)
        currentStroke = {
          tool: activeTool,
          color: activeColor,
          lineWidth: lineWidth(activeTool),
          points: [p],
          start: p,
          end: p,
        }
        drawing = true
      })
      canvas.addEventListener('mousemove', (e) => {
        if (!drawing || !currentStroke) return
        e.preventDefault()
        const p = getPos(e)
        currentStroke.points.push(p)
        currentStroke.end = p
        redraw()
      })
      canvas.addEventListener('mouseup', (e) => {
        if (!drawing || !currentStroke) return
        e.preventDefault()
        const p = getPos(e)
        currentStroke.points.push(p)
        currentStroke.end = p
        strokes.push(currentStroke)
        currentStroke = null
        drawing = false
        redraw()
      })
      canvas.addEventListener('mouseleave', () => {
        if (drawing && currentStroke) {
          strokes.push(currentStroke)
          currentStroke = null
          drawing = false
          redraw()
        }
      })

      // Touch support
      canvas.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault()
          const p = getPos(e)
          currentStroke = {
            tool: activeTool,
            color: activeColor,
            lineWidth: lineWidth(activeTool),
            points: [p],
            start: p,
            end: p,
          }
          drawing = true
        },
        { passive: false },
      )
      canvas.addEventListener(
        'touchmove',
        (e) => {
          if (!drawing || !currentStroke) return
          e.preventDefault()
          const p = getPos(e)
          currentStroke.points.push(p)
          currentStroke.end = p
          redraw()
        },
        { passive: false },
      )
      canvas.addEventListener(
        'touchend',
        (e) => {
          if (!drawing || !currentStroke) return
          e.preventDefault()
          strokes.push(currentStroke)
          currentStroke = null
          drawing = false
          redraw()
        },
        { passive: false },
      )

      // Escape to cancel
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          cleanup()
          resolve(null)
        }
      }
      document.addEventListener('keydown', onKeyDown)

      function cleanup() {
        document.removeEventListener('keydown', onKeyDown)
        overlay.remove()
      }

      document.body.appendChild(overlay)
    }
    img.src = `data:image/jpeg;base64,${imageBase64}`
  })
}
