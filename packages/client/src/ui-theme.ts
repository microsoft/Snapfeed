export type SnapfeedStylePreset = "modern" | "windows90s" | "terminal";

export interface SnapfeedTheme {
  fontFamily: string;
  overlayBackdrop: string;
  panelBackground: string;
  panelText: string;
  panelBorder: string;
  panelRadius: string;
  panelShadow: string;
  toolbarBackground: string;
  toolbarBorder: string;
  toolbarRadius: string;
  toolbarShadow: string;
  mutedText: string;
  inputBackground: string;
  inputBorder: string;
  inputText: string;
  buttonText: string;
  buttonBorder: string;
  accent: string;
  accentSoft: string;
  accentContrast: string;
  separator: string;
  canvasRadius: string;
  canvasShadow: string;
}

const PRESETS: Record<SnapfeedStylePreset, SnapfeedTheme> = {
  modern: {
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    overlayBackdrop: "rgba(0,0,0,0.85)",
    panelBackground: "#1e1e2e",
    panelText: "#cdd6f4",
    panelBorder: "#585b70",
    panelRadius: "8px",
    panelShadow: "0 8px 32px rgba(0,0,0,0.5)",
    toolbarBackground: "#2c2c2e",
    toolbarBorder: "rgba(255,255,255,0.12)",
    toolbarRadius: "12px",
    toolbarShadow: "0 8px 32px rgba(0,0,0,0.24)",
    mutedText: "#6c7086",
    inputBackground: "#313244",
    inputBorder: "#585b70",
    inputText: "#cdd6f4",
    buttonText: "#f2f2f7",
    buttonBorder: "rgba(255,255,255,0.12)",
    accent: "#89b4fa",
    accentSoft: "rgba(137,180,250,0.15)",
    accentContrast: "#1e1e2e",
    separator: "rgba(255,255,255,0.12)",
    canvasRadius: "8px",
    canvasShadow: "0 8px 32px rgba(0,0,0,0.5)",
  },
  windows90s: {
    fontFamily: '"MS Sans Serif", "Microsoft Sans Serif", Arial, sans-serif',
    overlayBackdrop: "rgba(0, 32, 64, 0.48)",
    panelBackground: "#c0c0c0",
    panelText: "#000000",
    panelBorder: "#808080",
    panelRadius: "0px",
    panelShadow: "2px 2px 0 #000000",
    toolbarBackground: "#c0c0c0",
    toolbarBorder: "#808080",
    toolbarRadius: "0px",
    toolbarShadow: "2px 2px 0 #000000",
    mutedText: "#404040",
    inputBackground: "#ffffff",
    inputBorder: "#808080",
    inputText: "#000000",
    buttonText: "#000000",
    buttonBorder: "#808080",
    accent: "#000080",
    accentSoft: "rgba(0, 0, 128, 0.12)",
    accentContrast: "#ffffff",
    separator: "#808080",
    canvasRadius: "0px",
    canvasShadow: "2px 2px 0 #000000",
  },
  terminal: {
    fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    overlayBackdrop: "rgba(5, 12, 5, 0.9)",
    panelBackground: "#081408",
    panelText: "#9dff9d",
    panelBorder: "#2b7d2b",
    panelRadius: "0px",
    panelShadow:
      "0 0 0 1px rgba(67, 160, 71, 0.45), 0 18px 50px rgba(0,0,0,0.55)",
    toolbarBackground: "#0b1b0b",
    toolbarBorder: "#2b7d2b",
    toolbarRadius: "0px",
    toolbarShadow: "0 0 0 1px rgba(67, 160, 71, 0.35)",
    mutedText: "#6bb36b",
    inputBackground: "#071007",
    inputBorder: "#2b7d2b",
    inputText: "#9dff9d",
    buttonText: "#9dff9d",
    buttonBorder: "#2b7d2b",
    accent: "#56f356",
    accentSoft: "rgba(86, 243, 86, 0.16)",
    accentContrast: "#071007",
    separator: "rgba(67, 160, 71, 0.45)",
    canvasRadius: "0px",
    canvasShadow:
      "0 0 0 1px rgba(67, 160, 71, 0.35), 0 10px 30px rgba(0,0,0,0.45)",
  },
};

let currentPreset: SnapfeedStylePreset = "modern";

export function getSnapfeedTheme(): SnapfeedTheme {
  return PRESETS[currentPreset];
}

export function getSnapfeedStylePreset(): SnapfeedStylePreset {
  return currentPreset;
}

export function setSnapfeedStylePreset(preset: SnapfeedStylePreset): void {
  currentPreset = preset;
}

export function getSnapfeedStylePresets(): SnapfeedStylePreset[] {
  return Object.keys(PRESETS) as SnapfeedStylePreset[];
}
