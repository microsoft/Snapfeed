export type SnapfeedStylePreset =
  | 'modern'
  | 'windows90s'
  | 'terminal'
  | 'githubLight'
  | 'dracula'
  | 'nord'

export interface SnapfeedTheme {
  fontFamily: string
  overlayBackdrop: string
  panelBackground: string
  panelText: string
  panelBorder: string
  panelRadius: string
  panelShadow: string
  toolbarBackground: string
  toolbarBorder: string
  toolbarRadius: string
  toolbarShadow: string
  mutedText: string
  inputBackground: string
  inputBorder: string
  inputText: string
  buttonText: string
  buttonBorder: string
  accent: string
  accentSoft: string
  accentContrast: string
  separator: string
  canvasRadius: string
  canvasShadow: string
}

const PRESETS: Record<SnapfeedStylePreset, SnapfeedTheme> = {
  modern: {
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    overlayBackdrop: 'rgba(0,0,0,0.85)',
    panelBackground: '#1e1e2e',
    panelText: '#cdd6f4',
    panelBorder: '#585b70',
    panelRadius: '8px',
    panelShadow: '0 8px 32px rgba(0,0,0,0.5)',
    toolbarBackground: '#2c2c2e',
    toolbarBorder: 'rgba(255,255,255,0.12)',
    toolbarRadius: '12px',
    toolbarShadow: '0 8px 32px rgba(0,0,0,0.24)',
    mutedText: '#6c7086',
    inputBackground: '#313244',
    inputBorder: '#585b70',
    inputText: '#cdd6f4',
    buttonText: '#f2f2f7',
    buttonBorder: 'rgba(255,255,255,0.12)',
    accent: '#89b4fa',
    accentSoft: 'rgba(137,180,250,0.15)',
    accentContrast: '#1e1e2e',
    separator: 'rgba(255,255,255,0.12)',
    canvasRadius: '8px',
    canvasShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  windows90s: {
    fontFamily: '"MS Sans Serif", "Microsoft Sans Serif", Arial, sans-serif',
    overlayBackdrop: 'rgba(0, 32, 64, 0.48)',
    panelBackground: '#c0c0c0',
    panelText: '#000000',
    panelBorder: '#808080',
    panelRadius: '0px',
    panelShadow: '2px 2px 0 #000000',
    toolbarBackground: '#c0c0c0',
    toolbarBorder: '#808080',
    toolbarRadius: '0px',
    toolbarShadow: '2px 2px 0 #000000',
    mutedText: '#404040',
    inputBackground: '#ffffff',
    inputBorder: '#808080',
    inputText: '#000000',
    buttonText: '#000000',
    buttonBorder: '#808080',
    accent: '#000080',
    accentSoft: 'rgba(0, 0, 128, 0.12)',
    accentContrast: '#ffffff',
    separator: '#808080',
    canvasRadius: '0px',
    canvasShadow: '2px 2px 0 #000000',
  },
  terminal: {
    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    overlayBackdrop: 'rgba(5, 12, 5, 0.9)',
    panelBackground: '#081408',
    panelText: '#9dff9d',
    panelBorder: '#2b7d2b',
    panelRadius: '0px',
    panelShadow: '0 0 0 1px rgba(67, 160, 71, 0.45), 0 18px 50px rgba(0,0,0,0.55)',
    toolbarBackground: '#0b1b0b',
    toolbarBorder: '#2b7d2b',
    toolbarRadius: '0px',
    toolbarShadow: '0 0 0 1px rgba(67, 160, 71, 0.35)',
    mutedText: '#6bb36b',
    inputBackground: '#071007',
    inputBorder: '#2b7d2b',
    inputText: '#9dff9d',
    buttonText: '#9dff9d',
    buttonBorder: '#2b7d2b',
    accent: '#56f356',
    accentSoft: 'rgba(86, 243, 86, 0.16)',
    accentContrast: '#071007',
    separator: 'rgba(67, 160, 71, 0.45)',
    canvasRadius: '0px',
    canvasShadow: '0 0 0 1px rgba(67, 160, 71, 0.35), 0 10px 30px rgba(0,0,0,0.45)',
  },
  githubLight: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
    overlayBackdrop: 'rgba(9, 30, 66, 0.32)',
    panelBackground: '#ffffff',
    panelText: '#1f2328',
    panelBorder: '#d0d7de',
    panelRadius: '10px',
    panelShadow: '0 16px 40px rgba(31, 35, 40, 0.12)',
    toolbarBackground: '#f6f8fa',
    toolbarBorder: '#d0d7de',
    toolbarRadius: '999px',
    toolbarShadow: '0 12px 30px rgba(31, 35, 40, 0.1)',
    mutedText: '#59636e',
    inputBackground: '#ffffff',
    inputBorder: '#d0d7de',
    inputText: '#1f2328',
    buttonText: '#24292f',
    buttonBorder: '#d0d7de',
    accent: '#0969da',
    accentSoft: 'rgba(9, 105, 218, 0.12)',
    accentContrast: '#ffffff',
    separator: 'rgba(208, 215, 222, 0.95)',
    canvasRadius: '14px',
    canvasShadow: '0 18px 48px rgba(31, 35, 40, 0.16)',
  },
  dracula: {
    fontFamily: '"Inter", "Segoe UI", sans-serif',
    overlayBackdrop: 'rgba(20, 20, 31, 0.82)',
    panelBackground: '#282a36',
    panelText: '#f8f8f2',
    panelBorder: '#44475a',
    panelRadius: '14px',
    panelShadow: '0 18px 50px rgba(0, 0, 0, 0.42)',
    toolbarBackground: '#343746',
    toolbarBorder: '#6272a4',
    toolbarRadius: '14px',
    toolbarShadow: '0 14px 36px rgba(0, 0, 0, 0.32)',
    mutedText: '#bd93f9',
    inputBackground: '#21222c',
    inputBorder: '#6272a4',
    inputText: '#f8f8f2',
    buttonText: '#f8f8f2',
    buttonBorder: '#6272a4',
    accent: '#ff79c6',
    accentSoft: 'rgba(255, 121, 198, 0.16)',
    accentContrast: '#1f1f28',
    separator: 'rgba(98, 114, 164, 0.65)',
    canvasRadius: '16px',
    canvasShadow: '0 22px 52px rgba(0, 0, 0, 0.4)',
  },
  nord: {
    fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
    overlayBackdrop: 'rgba(28, 35, 48, 0.72)',
    panelBackground: '#2e3440',
    panelText: '#eceff4',
    panelBorder: '#4c566a',
    panelRadius: '12px',
    panelShadow: '0 18px 44px rgba(15, 23, 42, 0.3)',
    toolbarBackground: '#3b4252',
    toolbarBorder: '#4c566a',
    toolbarRadius: '12px',
    toolbarShadow: '0 14px 34px rgba(15, 23, 42, 0.22)',
    mutedText: '#d8dee9',
    inputBackground: '#434c5e',
    inputBorder: '#4c566a',
    inputText: '#eceff4',
    buttonText: '#eceff4',
    buttonBorder: '#81a1c1',
    accent: '#88c0d0',
    accentSoft: 'rgba(136, 192, 208, 0.16)',
    accentContrast: '#2e3440',
    separator: 'rgba(129, 161, 193, 0.42)',
    canvasRadius: '14px',
    canvasShadow: '0 18px 40px rgba(15, 23, 42, 0.28)',
  },
}

let currentPreset: SnapfeedStylePreset = 'modern'

export function getSnapfeedTheme(): SnapfeedTheme {
  return PRESETS[currentPreset]
}

export function getSnapfeedStylePreset(): SnapfeedStylePreset {
  return currentPreset
}

export function setSnapfeedStylePreset(preset: SnapfeedStylePreset): void {
  currentPreset = preset
}

export function getSnapfeedStylePresets(): SnapfeedStylePreset[] {
  return Object.keys(PRESETS) as SnapfeedStylePreset[]
}
