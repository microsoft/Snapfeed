/**
 * Annotation canvas — draw on screenshots before submitting feedback.
 * Pure DOM implementation (no React dependency).
 * Tools: pen, rectangle, arrow, highlighter.
 */

import { getSnapfeedTheme } from "./ui-theme.js";

type AnnotationTool = "pen" | "rect" | "arrow" | "highlighter";

type ToolDefinition = {
  id: AnnotationTool;
  iconSvg: string;
  label: string;
  shortcut: string;
};

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  tool: AnnotationTool;
  color: string;
  lineWidth: number;
  points: Point[];
  start?: Point;
  end?: Point;
}

const TOOLS: ToolDefinition[] = [
  {
    id: "pen",
    iconSvg:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l2.8-.6L13 5.2 10.8 3 3.6 10.2 3 13z"/><path d="M9.8 4l2.2 2.2"/></svg>',
    label: "Pen",
    shortcut: "1",
  },
  {
    id: "rect",
    iconSvg:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="10" height="8" rx="1.5"/></svg>',
    label: "Rectangle",
    shortcut: "2",
  },
  {
    id: "arrow",
    iconSvg:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12L12 3"/><path d="M7 3h5v5"/></svg>',
    label: "Arrow",
    shortcut: "3",
  },
  {
    id: "highlighter",
    iconSvg:
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 11l5.8-5.8 1.7 1.7L6.7 12.7H4.5z"/><path d="M9.5 3.8l2.7 2.7"/><path d="M3.5 13h9"/></svg>',
    label: "Highlight",
    shortcut: "4",
  },
];

const COLORS = ["#EF4444", "#FBBF24", "#3B82F6", "#FFFFFF", "#111111"];
const COLOR_LABELS: Record<string, string> = {
  "#EF4444": "Red",
  "#FBBF24": "Amber",
  "#3B82F6": "Blue",
  "#FFFFFF": "White",
  "#111111": "Black",
};

function lineWidth(tool: AnnotationTool): number {
  return tool === "highlighter" ? 16 : tool === "pen" ? 2.5 : 3;
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (s.tool === "highlighter") {
    ctx.globalAlpha = 0.35;
  } else {
    ctx.globalAlpha = 1;
  }

  if (s.tool === "pen" || s.tool === "highlighter") {
    if (s.points.length < 2) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++)
      ctx.lineTo(s.points[i].x, s.points[i].y);
    ctx.stroke();
  } else if (s.tool === "rect" && s.start && s.end) {
    const x = Math.min(s.start.x, s.end.x),
      y = Math.min(s.start.y, s.end.y);
    const w = Math.abs(s.end.x - s.start.x),
      h = Math.abs(s.end.y - s.start.y);
    ctx.strokeRect(x, y, w, h);
  } else if (s.tool === "arrow" && s.start && s.end) {
    const angle = Math.atan2(s.end.y - s.start.y, s.end.x - s.start.x);
    const headLen = Math.max(12, s.lineWidth * 5);
    ctx.beginPath();
    ctx.moveTo(s.start.x, s.start.y);
    ctx.lineTo(s.end.x, s.end.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.end.x, s.end.y);
    ctx.lineTo(
      s.end.x - headLen * Math.cos(angle - Math.PI / 7),
      s.end.y - headLen * Math.sin(angle - Math.PI / 7),
    );
    ctx.moveTo(s.end.x, s.end.y);
    ctx.lineTo(
      s.end.x - headLen * Math.cos(angle + Math.PI / 7),
      s.end.y - headLen * Math.sin(angle + Math.PI / 7),
    );
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Show a full-screen annotation overlay on an image.
 * Returns a promise that resolves with the annotated base64 JPEG, or null if cancelled.
 */
export function showAnnotationCanvas(
  imageBase64: string,
  quality: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const strokes: Stroke[] = [];
    let currentStroke: Stroke | null = null;
    let activeTool: AnnotationTool = "pen";
    let activeColor = "#EF4444";
    let drawing = false;
    const theme = getSnapfeedTheme();

    // Load image to get dimensions
    const img = new Image();
    img.onload = () => {
      const maxW = window.innerWidth * 0.9,
        maxH = window.innerHeight * 0.75;
      const scale = Math.min(
        1,
        maxW / img.naturalWidth,
        maxH / img.naturalHeight,
      );
      const displayW = Math.round(img.naturalWidth * scale);
      const displayH = Math.round(img.naturalHeight * scale);

      // Overlay
      const overlay = document.createElement("div");
      overlay.dataset.snapfeedOverlay = "annotation-canvas";
      overlay.style.cssText = `
        position:fixed; inset:0; z-index:100000; background:${theme.overlayBackdrop};
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        gap:12px; padding:16px; box-sizing:border-box;
        font-family:${theme.fontFamily}; font-size:13px;
      `;
      for (const evt of [
        "keydown",
        "keyup",
        "mousedown",
        "mouseup",
        "click",
        "pointerdown",
        "pointerup",
      ]) {
        overlay.addEventListener(evt, (e) => e.stopPropagation());
      }

      // Toolbar
      const toolbar = document.createElement("div");
      toolbar.style.cssText = `
        background:${theme.toolbarBackground}; border:1px solid ${theme.toolbarBorder}; border-radius:${theme.toolbarRadius};
        box-shadow:${theme.toolbarShadow}; color:${theme.panelText};
        padding:10px 12px; display:grid; gap:8px;
        max-width:${displayW}px; width:100%; box-sizing:border-box;
      `;

      const toolbarTop = document.createElement("div");
      toolbarTop.style.cssText =
        "display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;";

      const toolbarTitle = document.createElement("div");
      toolbarTitle.style.cssText = "display:grid; gap:2px; min-width:0;";
      toolbarTitle.innerHTML = `
        <div style="font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:${theme.mutedText};">Annotation</div>
        <div id="__sf_annotation_summary" style="font-size:12px; color:${theme.panelText}; line-height:1.35;"></div>
      `;
      toolbarTop.appendChild(toolbarTitle);

      const toolbarActions = document.createElement("div");
      toolbarActions.style.cssText =
        "display:flex; align-items:center; gap:6px; flex-wrap:wrap;";
      toolbarTop.appendChild(toolbarActions);

      toolbar.appendChild(toolbarTop);

      const toolbarMain = document.createElement("div");
      toolbarMain.style.cssText =
        "display:flex; align-items:flex-start; gap:8px; flex-wrap:wrap;";
      toolbar.appendChild(toolbarMain);

      const toolbarHint = document.createElement("div");
      toolbarHint.style.cssText = `font-size:10px; line-height:1.4; color:${theme.mutedText};`;
      toolbarHint.textContent =
        "Shortcuts: 1-4 tools, Cmd/Ctrl+Z undo, Backspace clear, Enter done, Esc cancel.";
      toolbar.appendChild(toolbarHint);

      function createBtn(
        text: string,
        onClick: () => void,
        style?: string,
      ): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.style.cssText = `
          min-height:30px; border-radius:8px; border:2px solid transparent; background:transparent;
          cursor:pointer; font-size:13px; padding:0 9px; color:${theme.buttonText}; font-family:inherit;
          ${style ?? ""}
        `;
        btn.onclick = onClick;
        return btn;
      }

      function createToolbarGroup(label: string): HTMLDivElement {
        const group = document.createElement("div");
        group.style.cssText = `display:grid; gap:5px; padding:7px 9px; border:1px solid ${theme.toolbarBorder}; border-radius:10px; background:${theme.inputBackground};`;
        const groupLabel = document.createElement("div");
        groupLabel.style.cssText = `font-size:9px; letter-spacing:0.14em; text-transform:uppercase; color:${theme.mutedText};`;
        groupLabel.textContent = label;
        group.appendChild(groupLabel);
        return group;
      }

      const toolsGroup = createToolbarGroup("Tools");
      const toolsRow = document.createElement("div");
      toolsRow.style.cssText =
        "display:flex; align-items:center; gap:6px; flex-wrap:wrap;";
      toolsGroup.appendChild(toolsRow);
      toolbarMain.appendChild(toolsGroup);

      const colorsGroup = createToolbarGroup("Colors");
      const colorsRow = document.createElement("div");
      colorsRow.style.cssText =
        "display:flex; align-items:center; gap:6px; flex-wrap:wrap;";
      colorsGroup.appendChild(colorsRow);
      toolbarMain.appendChild(colorsGroup);

      const annotationSummary = toolbar.querySelector(
        "#__sf_annotation_summary",
      ) as HTMLDivElement;

      function updateToolbarSummary(): void {
        const toolLabel =
          TOOLS.find((tool) => tool.id === activeTool)?.label ?? "Pen";
        const colorLabel = COLOR_LABELS[activeColor] ?? activeColor;
        annotationSummary.textContent = `${toolLabel} selected • ${colorLabel} • ${strokes.length} mark${strokes.length === 1 ? "" : "s"}`;
      }

      // Tool buttons
      const toolBtns: HTMLButtonElement[] = [];
      for (const t of TOOLS) {
        const btn = createBtn(t.label, () => {
          activeTool = t.id;
          updateToolButtons();
          updateToolbarSummary();
        });
        btn.innerHTML = `<span style="display:inline-flex; width:14px; height:14px; align-items:center; justify-content:center;">${t.iconSvg}</span><span style="font-size:12px;">${t.label}</span>`;
        btn.title = `${t.label} (${t.shortcut})`;
        btn.style.display = "inline-flex";
        btn.style.alignItems = "center";
        btn.style.gap = "5px";
        toolBtns.push(btn);
        toolsRow.appendChild(btn);
      }

      function updateToolButtons(): void {
        toolBtns.forEach((b, i) => {
          const isActive = TOOLS[i].id === activeTool;
          b.style.border = isActive
            ? `2px solid ${theme.accent}`
            : "2px solid transparent";
          b.style.background = isActive ? theme.accentSoft : "transparent";
          b.style.fontWeight = isActive ? "700" : "500";
        });
      }

      updateToolButtons();

      // Color dots
      const colorDots: HTMLButtonElement[] = [];
      for (const c of COLORS) {
        const dot = document.createElement("button");
        dot.style.cssText = `
          width:18px; height:18px; border-radius:50%; border:2px solid ${c === activeColor ? theme.accent : theme.buttonBorder};
          background:${c}; cursor:pointer; padding:0; flex-shrink:0;
        `;
        dot.onclick = () => {
          activeColor = c;
          updateColorButtons();
          updateToolbarSummary();
        };
        dot.dataset.colorDot = c;
        dot.title = COLOR_LABELS[c] ?? c;
        colorDots.push(dot);
        colorsRow.appendChild(dot);
      }

      const colorLabel = document.createElement("div");
      colorLabel.style.cssText = `font-size:10px; color:${theme.panelText}; line-height:1.35;`;
      colorsGroup.appendChild(colorLabel);

      function updateColorButtons(): void {
        colorDots.forEach((dot) => {
          dot.style.border = `2px solid ${dot.dataset.colorDot === activeColor ? theme.accent : theme.buttonBorder}`;
          dot.style.transform =
            dot.dataset.colorDot === activeColor ? "scale(1.08)" : "scale(1)";
        });
        colorLabel.textContent = `Active color: ${COLOR_LABELS[activeColor] ?? activeColor}`;
      }

      updateColorButtons();

      // Undo
      const undoButton = createBtn(
        "Undo",
        () => {
          if (strokes.length === 0) return;
          strokes.pop();
          redraw();
          updateToolbarSummary();
          updateActionButtons();
        },
        `border:1px solid ${theme.buttonBorder};font-size:12px;`,
      );
      toolbarActions.appendChild(undoButton);

      const clearButton = createBtn(
        "Clear",
        () => {
          if (strokes.length === 0) return;
          strokes.length = 0;
          currentStroke = null;
          redraw();
          updateToolbarSummary();
          updateActionButtons();
        },
        `border:1px solid ${theme.buttonBorder};font-size:12px;`,
      );
      toolbarActions.appendChild(clearButton);

      function updateActionButtons(): void {
        const hasMarks = strokes.length > 0;
        undoButton.disabled = !hasMarks;
        clearButton.disabled = !hasMarks;
        for (const button of [undoButton, clearButton]) {
          button.style.opacity = button.disabled ? "0.45" : "1";
          button.style.cursor = button.disabled ? "not-allowed" : "pointer";
        }
      }

      updateActionButtons();

      // Cancel
      toolbarActions.appendChild(
        createBtn(
          "Cancel",
          () => {
            cleanup();
            resolve(null);
          },
          `border:1px solid ${theme.buttonBorder};font-size:12px;`,
        ),
      );

      // Done
      toolbarActions.appendChild(
        createBtn(
          "✓ Done",
          () => {
            // Merge image + annotations
            const mergeCanvas = document.createElement("canvas");
            mergeCanvas.width = img.naturalWidth;
            mergeCanvas.height = img.naturalHeight;
            const mctx = mergeCanvas.getContext("2d")!;
            mctx.drawImage(img, 0, 0);
            mctx.drawImage(canvas, 0, 0);
            const dataUrl = mergeCanvas.toDataURL("image/jpeg", quality);
            cleanup();
            resolve(dataUrl.split(",")[1] || null);
          },
          `background:${theme.accent};color:${theme.accentContrast};font-weight:600;font-size:12px;border:none;`,
        ),
      );

      updateToolbarSummary();

      overlay.appendChild(toolbar);

      // Canvas container
      const container = document.createElement("div");
      container.style.cssText = `position:relative;width:${displayW}px;height:${displayH}px;border-radius:${theme.canvasRadius};overflow:hidden;box-shadow:${theme.canvasShadow};`;

      // Background image
      const bgImg = document.createElement("img");
      bgImg.src = `data:image/jpeg;base64,${imageBase64}`;
      bgImg.draggable = false;
      bgImg.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;user-select:none;";
      container.appendChild(bgImg);

      // Drawing canvas
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none;`;
      container.appendChild(canvas);
      overlay.appendChild(container);

      const ctx = canvas.getContext("2d")!;

      function getPos(e: MouseEvent | TouchEvent): Point {
        const rect = canvas.getBoundingClientRect();
        const sx = canvas.width / rect.width,
          sy = canvas.height / rect.height;
        const clientX =
          "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
        const clientY =
          "touches" in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;
        return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
      }

      function redraw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const s of strokes) drawStroke(ctx, s);
        if (currentStroke) drawStroke(ctx, currentStroke);
      }

      canvas.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const p = getPos(e);
        currentStroke = {
          tool: activeTool,
          color: activeColor,
          lineWidth: lineWidth(activeTool),
          points: [p],
          start: p,
          end: p,
        };
        drawing = true;
      });
      canvas.addEventListener("mousemove", (e) => {
        if (!drawing || !currentStroke) return;
        e.preventDefault();
        const p = getPos(e);
        currentStroke.points.push(p);
        currentStroke.end = p;
        redraw();
      });
      canvas.addEventListener("mouseup", (e) => {
        if (!drawing || !currentStroke) return;
        e.preventDefault();
        const p = getPos(e);
        currentStroke.points.push(p);
        currentStroke.end = p;
        strokes.push(currentStroke);
        currentStroke = null;
        drawing = false;
        redraw();
        updateToolbarSummary();
        updateActionButtons();
      });
      canvas.addEventListener("mouseleave", () => {
        if (drawing && currentStroke) {
          strokes.push(currentStroke);
          currentStroke = null;
          drawing = false;
          redraw();
          updateToolbarSummary();
          updateActionButtons();
        }
      });

      // Touch support
      canvas.addEventListener(
        "touchstart",
        (e) => {
          e.preventDefault();
          const p = getPos(e);
          currentStroke = {
            tool: activeTool,
            color: activeColor,
            lineWidth: lineWidth(activeTool),
            points: [p],
            start: p,
            end: p,
          };
          drawing = true;
        },
        { passive: false },
      );
      canvas.addEventListener(
        "touchmove",
        (e) => {
          if (!drawing || !currentStroke) return;
          e.preventDefault();
          const p = getPos(e);
          currentStroke.points.push(p);
          currentStroke.end = p;
          redraw();
        },
        { passive: false },
      );
      canvas.addEventListener(
        "touchend",
        (e) => {
          if (!drawing || !currentStroke) return;
          e.preventDefault();
          strokes.push(currentStroke);
          currentStroke = null;
          drawing = false;
          redraw();
          updateToolbarSummary();
          updateActionButtons();
        },
        { passive: false },
      );

      // Escape to cancel
      const onKeyDown = (e: KeyboardEvent) => {
        const lowerKey = e.key.toLowerCase();
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          // Merge image + annotations
          const mergeCanvas = document.createElement("canvas");
          mergeCanvas.width = img.naturalWidth;
          mergeCanvas.height = img.naturalHeight;
          const mctx = mergeCanvas.getContext("2d")!;
          mctx.drawImage(img, 0, 0);
          mctx.drawImage(canvas, 0, 0);
          const dataUrl = mergeCanvas.toDataURL("image/jpeg", quality);
          cleanup();
          resolve(dataUrl.split(",")[1] || null);
          return;
        }
        if ((e.metaKey || e.ctrlKey) && lowerKey === "z") {
          e.preventDefault();
          if (strokes.length === 0) return;
          strokes.pop();
          redraw();
          updateToolbarSummary();
          updateActionButtons();
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          if (strokes.length === 0) return;
          strokes.length = 0;
          currentStroke = null;
          redraw();
          updateToolbarSummary();
          updateActionButtons();
          return;
        }
        const toolIndex = Number(e.key);
        if (toolIndex >= 1 && toolIndex <= TOOLS.length) {
          activeTool = TOOLS[toolIndex - 1].id;
          updateToolButtons();
          updateToolbarSummary();
        }
      };
      document.addEventListener("keydown", onKeyDown);

      function cleanup() {
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
      }

      document.body.appendChild(overlay);
    };
    img.src = `data:image/jpeg;base64,${imageBase64}`;
  });
}
