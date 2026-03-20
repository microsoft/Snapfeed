/**
 * Annotation canvas — draw on screenshots before submitting feedback.
 * Pure DOM implementation (no React dependency).
 * Tools: pen, rectangle, arrow, highlighter.
 */

import { getSnapfeedTheme } from './ui-theme.js'

type AnnotationTool = 'pen' | 'rect' | 'arrow' | 'highlighter'
type PathTool = 'pen' | 'highlighter'
type ShapeTool = 'rect' | 'arrow'

interface Point {
  x: number
  y: number
}

interface BaseStroke {
  color: string
  lineWidth: number
}

interface PathStroke extends BaseStroke {
  tool: PathTool
  points: [Point, ...Point[]]
}

interface ShapeStroke extends BaseStroke {
  tool: ShapeTool
  start: Point
  end: Point
}

type Stroke = PathStroke | ShapeStroke

const TOOLS: Array<{ id: AnnotationTool; emoji: string; title: string }> = [
  { id: 'pen', emoji: '✏️', title: 'Free draw' },
  { id: 'rect', emoji: '⬜', title: 'Rectangle' },
  { id: 'arrow', emoji: '↗', title: 'Arrow' },
  { id: 'highlighter', emoji: '🖊', title: 'Highlighter' },
]

const COLORS = ['#EF4444', '#FBBF24', '#3B82F6', '#FFFFFF', '#111111']

function lineWidth(tool: AnnotationTool): number {
  switch (tool) {
    case 'highlighter':
      return 16
    case 'pen':
      return 2.5
    case 'rect':
    case 'arrow':
      return 3
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected annotation tool: ${String(value)}`)
}

function createStroke(tool: AnnotationTool, color: string, point: Point): Stroke {
  const baseStroke = {
    color,
    lineWidth: lineWidth(tool),
  }

  switch (tool) {
    case 'pen':
    case 'highlighter':
      return {
        ...baseStroke,
        tool,
        points: [point],
      }
    case 'rect':
    case 'arrow':
      return {
        ...baseStroke,
        tool,
        start: point,
        end: point,
      }
    default:
      return assertNever(tool)
  }
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Annotation canvas context is unavailable')
  }

  return context
}

function isPathStroke(stroke: Stroke): stroke is PathStroke {
  return stroke.tool === 'pen' || stroke.tool === 'highlighter'
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  ctx.save()
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = stroke.tool === 'highlighter' ? 0.35 : 1

  switch (stroke.tool) {
    case 'pen':
    case 'highlighter': {
      if (stroke.points.length < 2) {
        ctx.restore()
        return
      }

      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (let index = 1; index < stroke.points.length; index++) {
        ctx.lineTo(stroke.points[index].x, stroke.points[index].y)
      }
      ctx.stroke()
      break
    }
    case 'rect': {
      const x = Math.min(stroke.start.x, stroke.end.x)
      const y = Math.min(stroke.start.y, stroke.end.y)
      const width = Math.abs(stroke.end.x - stroke.start.x)
      const height = Math.abs(stroke.end.y - stroke.start.y)
      ctx.strokeRect(x, y, width, height)
      break
    }
    case 'arrow': {
      const angle = Math.atan2(stroke.end.y - stroke.start.y, stroke.end.x - stroke.start.x)
      const headLength = Math.max(12, stroke.lineWidth * 5)
      ctx.beginPath()
      ctx.moveTo(stroke.start.x, stroke.start.y)
      ctx.lineTo(stroke.end.x, stroke.end.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(stroke.end.x, stroke.end.y)
      ctx.lineTo(
        stroke.end.x - headLength * Math.cos(angle - Math.PI / 7),
        stroke.end.y - headLength * Math.sin(angle - Math.PI / 7),
      )
      ctx.moveTo(stroke.end.x, stroke.end.y)
      ctx.lineTo(
        stroke.end.x - headLength * Math.cos(angle + Math.PI / 7),
        stroke.end.y - headLength * Math.sin(angle + Math.PI / 7),
      )
      ctx.stroke()
      break
    }
    default:
      assertNever(stroke)
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
    let activePointerId: number | null = null
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

      function updateToolButtons(buttons: HTMLButtonElement[]) {
        buttons.forEach((button, index) => {
          const isActive = TOOLS[index].id === activeTool
          button.style.border = isActive ? `2px solid ${theme.accent}` : '2px solid transparent'
          button.style.background = isActive ? theme.accentSoft : 'transparent'
        })
      }

      function updateColorDots() {
        toolbar.querySelectorAll<HTMLElement>('[data-color-dot]').forEach((dot) => {
          const isActive = dot.dataset.colorDot === activeColor
          dot.style.border = `2px solid ${isActive ? theme.accent : theme.buttonBorder}`
        })
      }

      // Tool buttons
      const toolBtns: HTMLButtonElement[] = []
      for (const t of TOOLS) {
        const btn = createBtn(t.emoji, () => {
          activeTool = t.id
          updateToolButtons(toolBtns)
        })
        btn.title = t.title
        toolBtns.push(btn)
        toolbar.appendChild(btn)
      }
      updateToolButtons(toolBtns)

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
          updateColorDots()
        }
        dot.dataset.colorDot = c
        toolbar.appendChild(dot)
      }
      updateColorDots()

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

      const ctx = getCanvasContext(canvas)

      function getPos(e: PointerEvent): Point {
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
        }
      }

      function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (const stroke of strokes) drawStroke(ctx, stroke)
        if (currentStroke) drawStroke(ctx, currentStroke)
      }

      function beginStroke(e: PointerEvent) {
        if (activePointerId !== null) {
          return
        }

        e.preventDefault()
        activePointerId = e.pointerId
        currentStroke = createStroke(activeTool, activeColor, getPos(e))
        canvas.setPointerCapture(e.pointerId)
      }

      function updateStroke(e: PointerEvent) {
        if (e.pointerId !== activePointerId || !currentStroke) {
          return
        }

        e.preventDefault()
        const point = getPos(e)

        if (isPathStroke(currentStroke)) {
          currentStroke.points.push(point)
        } else {
          currentStroke.end = point
        }

        redraw()
      }

      function finishStroke(e: PointerEvent) {
        if (e.pointerId !== activePointerId || !currentStroke) {
          return
        }

        updateStroke(e)
        strokes.push(currentStroke)
        currentStroke = null
        activePointerId = null
        canvas.releasePointerCapture(e.pointerId)
        redraw()
      }

      function cancelStroke() {
        if (activePointerId !== null && canvas.hasPointerCapture(activePointerId)) {
          canvas.releasePointerCapture(activePointerId)
        }

        currentStroke = null
        activePointerId = null
        redraw()
      }

      canvas.addEventListener('pointerdown', beginStroke)
      canvas.addEventListener('pointermove', updateStroke)
      canvas.addEventListener('pointerup', finishStroke)
      canvas.addEventListener('pointercancel', cancelStroke)

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
