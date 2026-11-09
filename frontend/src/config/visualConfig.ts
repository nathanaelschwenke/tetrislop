import type { PieceType } from '../core/Tetromino';

export interface HSL {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

/** Base piece colours in HSL so they can be modulated at runtime. */
export const PIECE_COLORS: Record<PieceType, HSL> = {
  I: { h: 190, s: 90, l: 50 },
  J: { h: 225, s: 85, l: 45 },
  L: { h: 30, s: 95, l: 52 },
  O: { h: 50, s: 95, l: 52 },
  S: { h: 130, s: 75, l: 45 },
  Z: { h: 0, s: 85, l: 52 },
  T: { h: 290, s: 80, l: 50 },
};

/** Anatomy of a single beveled vector cell (all ratios relative to cellSize). */
export const CELL_STYLE = {
  borderWidthRatio: 0.06,
  borderLightness: -18,
  innerLightness: 6,
  highlightLightness: 24,
  highlightSaturation: -10,
  shadowLightness: -22,
  ghost: {
    fillAlpha: 0.25,
    borderAlpha: 0.7,
    bevelAlpha: 0.18,
  },
} as const;

/** Runtime-modulatable parameters (see Renderer.setVisualModulation). */
export interface VisualModulation {
  bevelDepthRatio: number; // 0.08 .. 0.25 of cellSize
  contrastMultiplier: number; // scales highlight / shadow lightness offsets
  saturationShift: number; // added to every block saturation (percentage points)
  hueShiftDeg: number; // added to every block hue
  innerBrightnessOffset: number; // added to the inner fill lightness
}

export const DEFAULT_VISUAL_MODULATION: VisualModulation = {
  bevelDepthRatio: 0.14,
  contrastMultiplier: 1.0,
  saturationShift: 0,
  hueShiftDeg: 0,
  innerBrightnessOffset: 0,
};

export const VISUAL_LIMITS = {
  bevelDepthRatio: [0.08, 0.25] as const,
  contrastMultiplier: [0.2, 2.5] as const,
  saturationShift: [-100, 100] as const,
  hueShiftDeg: [-360, 360] as const,
  innerBrightnessOffset: [-40, 40] as const,
};

/**
 * How tension (0..1) maps onto the visual modulation and the scene.
 * Values are deltas applied at tension = 1.
 */
export const TENSION_VISUALS = {
  bevelDepthDelta: 0.05,
  contrastDelta: 0.35,
  saturationDelta: -18,
  hueShiftDeg: 0,
  innerBrightnessDelta: -4,
  frameCalmHue: 190, // board frame glow at tension 0
  frameDangerHue: 0, // board frame glow at tension 1
  vignetteMaxAlpha: 0.35,
  pulseHz: 1.6,
};

/** Scene colours used by the canvas fallbacks when UI PNGs are missing. */
export const SCENE = {
  backgroundTop: '#0b0f1e',
  backgroundBottom: '#04050b',
  gridLine: 'rgba(140, 170, 255, 0.05)',
  wellFill: 'rgba(6, 9, 20, 0.88)',
  wellGrid: 'rgba(150, 180, 255, 0.06)',
  panelFill: 'rgba(14, 19, 38, 0.72)',
  panelStroke: 'rgba(140, 170, 255, 0.16)',
  textPrimary: '#e8ecff',
  textMuted: '#8a93b8',
  accent: '#4fd8ff',
  fontFamily: '"Chakra Petch", "Segoe UI", system-ui, sans-serif',
  monoFamily: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
};
