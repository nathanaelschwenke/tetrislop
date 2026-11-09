import {
  CELL_STYLE,
  DEFAULT_VISUAL_MODULATION,
  PIECE_COLORS,
  SCENE,
  TENSION_VISUALS,
  VISUAL_LIMITS,
  type HSL,
  type VisualModulation,
} from '../config/visualConfig';
import { GAME_CONFIG } from '../config/gameConfig';
import type { CellValue } from '../core/Board';
import { localCells, type Cell, type PieceType } from '../core/Tetromino';
import type { EngineState } from '../core/types';
import type { UploadStatus } from '../telemetry/DataLogger';
import type { AssetLoader } from './AssetLoader';

/** Everything the renderer needs for one frame (read-only snapshot of the game). */
export interface RenderView {
  state: EngineState;
  grid: ReadonlyArray<ReadonlyArray<CellValue>>; // 22 x 10 incl. hidden rows
  active: { type: PieceType; cells: Cell[] } | null;
  ghost: Cell[] | null;
  lockProgress: number;
  nextQueue: PieceType[];
  score: number;
  level: number;
  lines: number;
  moves: number;
  combo: number;
  b2b: number;
  uploadStatus: UploadStatus;
  muted: boolean;
  touchMode: boolean;
  gameOverReason?: string;
}

interface Rect { x: number; y: number; w: number; h: number }

interface Layout {
  portrait: boolean;
  cell: number;
  well: Rect;
  logo: Rect;
  next: Rect;
  stats: Rect;
}

interface FloatingText { text: string; hue: number; start: number; big: boolean }
interface RowFlash { rows: number[]; start: number }
interface DropTrail { cells: Cell[]; distance: number; type: PieceType; start: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hsla = (h: number, s: number, l: number, a = 1) =>
  `hsla(${((h % 360) + 360) % 360}, ${clamp(s, 0, 100)}%, ${clamp(l, 0, 100)}%, ${a})`;

/**
 * Canvas renderer. Every block is drawn procedurally per 1x1 cell as a
 * beveled vector tile, so the light direction stays consistent across
 * rotations and partial line clears.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private layout!: Layout;

  private baseModulation: VisualModulation = { ...DEFAULT_VISUAL_MODULATION };
  private modulation: VisualModulation = { ...DEFAULT_VISUAL_MODULATION };
  private tension = 0;

  private floating: FloatingText[] = [];
  private flashes: RowFlash[] = [];
  private trails: DropTrail[] = [];
  private shakeUntil = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: AssetLoader,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.resize();
  }

  // ===========================================================================
  // Public modulation API (Phase 2 hooks)
  // ===========================================================================
  /** Sets the base visual modulation (partial update, values are clamped). */
  setVisualModulation(params: Partial<VisualModulation>): void {
    for (const key of Object.keys(params) as (keyof VisualModulation)[]) {
      const v = params[key];
      if (typeof v !== 'number' || Number.isNaN(v)) continue;
      const [lo, hi] = VISUAL_LIMITS[key];
      this.baseModulation[key] = clamp(v, lo, hi);
    }
    this.recomputeModulation();
  }

  getVisualModulation(): Readonly<VisualModulation> {
    return this.modulation;
  }

  /** Tension 0..1 shifts block textures, frame glow and vignette. */
  setTensionVisuals(tension: number): void {
    this.tension = clamp(tension, 0, 1);
    this.recomputeModulation();
  }

  private recomputeModulation(): void {
    const t = this.tension;
    const b = this.baseModulation;
    const tv = TENSION_VISUALS;
    this.modulation = {
      bevelDepthRatio: clamp(b.bevelDepthRatio + t * tv.bevelDepthDelta, ...VISUAL_LIMITS.bevelDepthRatio),
      contrastMultiplier: clamp(b.contrastMultiplier + t * tv.contrastDelta, ...VISUAL_LIMITS.contrastMultiplier),
      saturationShift: b.saturationShift + t * tv.saturationDelta,
      hueShiftDeg: b.hueShiftDeg + t * tv.hueShiftDeg,
      innerBrightnessOffset: b.innerBrightnessOffset + t * tv.innerBrightnessDelta,
    };
  }

  // ===========================================================================
  // Effects (purely visual, never delay the game loop)
  // ===========================================================================
  flashRows(boardRows: number[], now: number): void {
    const visible = boardRows.map((r) => r - GAME_CONFIG.hiddenRows).filter((r) => r >= 0);
    if (visible.length) this.flashes.push({ rows: visible, start: now });
  }

  popText(text: string, hue: number, now: number, big = false): void {
    this.floating.push({ text, hue, start: now, big });
    if (this.floating.length > 4) this.floating.shift();
  }

  dropTrail(cells: Cell[], distance: number, type: PieceType, now: number): void {
    if (distance > 0) this.trails.push({ cells, distance, type, start: now });
  }

  shake(now: number, ms = 140): void {
    this.shakeUntil = now + ms;
  }

  // ===========================================================================
  // Layout
  // ===========================================================================
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.layout = this.computeLayout();
  }

  private computeLayout(): Layout {
    const W = this.width;
    const H = this.height;
    const rows = GAME_CONFIG.visibleRows;
    const cols = GAME_CONFIG.cols;
    const portrait = W / H < 0.95;

    if (!portrait) {
      // [stats] [well] [next]
      const unitsW = 6 + 0.8 + cols + 0.8 + 6 + 1;
      const unitsH = 2.6 + rows + 1;
      const cell = Math.max(8, Math.floor(Math.min(W / unitsW, H / unitsH)));
      const wellW = cell * cols;
      const wellH = cell * rows;
      const totalW = cell * (6 + 0.8) * 2 + wellW;
      const x0 = Math.round((W - totalW) / 2);
      const y0 = Math.round((H - cell * unitsH) / 2 + cell * 0.5);
      const well = { x: x0 + Math.round(cell * 6.8), y: y0 + Math.round(cell * 2.6), w: wellW, h: wellH };
      return {
        portrait,
        cell,
        well,
        logo: { x: well.x - cell * 2, y: y0, w: wellW + cell * 4, h: cell * 2 },
        stats: { x: x0, y: well.y, w: cell * 6, h: cell * 12.5 },
        next: { x: well.x + wellW + Math.round(cell * 0.8), y: well.y, w: cell * 6, h: cell * 10.5 },
      };
    }

    // portrait: [well][side panel]
    const unitsW = cols + 0.5 + 4.6 + 0.6;
    const unitsH = 1.9 + rows + 0.4;
    const cell = Math.max(8, Math.floor(Math.min(W / unitsW, H / unitsH)));
    const wellW = cell * cols;
    const totalW = cell * (cols + 0.5 + 4.6);
    const x0 = Math.round((W - totalW) / 2);
    const y0 = Math.round((H - cell * unitsH) / 2);
    const well = { x: x0, y: y0 + Math.round(cell * 1.9), w: wellW, h: cell * rows };
    const sideX = well.x + wellW + Math.round(cell * 0.5);
    return {
      portrait,
      cell,
      well,
      logo: { x: x0, y: y0, w: totalW, h: cell * 1.5 },
      next: { x: sideX, y: well.y, w: cell * 4.6, h: cell * 8.2 },
      stats: { x: sideX, y: well.y + cell * 8.7, w: cell * 4.6, h: cell * 11.3 },
    };
  }

  // ===========================================================================
  // Frame
  // ===========================================================================
  render(view: RenderView, now: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    this.drawBackground(now);
    this.drawLogo();

    ctx.save();
    if (now < this.shakeUntil) {
      const k = (this.shakeUntil - now) / 140;
      ctx.translate(0, Math.round(Math.sin(now * 0.09) * 2.5 * k));
    }
    this.drawWell(view, now);
    ctx.restore();

    this.drawNext(view);
    this.drawStats(view);
    this.drawFloatingTexts(now);
    this.drawVignette(now);
    this.drawOverlay(view, now);
  }

  // ---- background / frame / logo ----------------------------------------------------
  private drawBackground(now: number): void {
    const ctx = this.ctx;
    const bg = this.assets.get('background');
    if (bg) {
      const s = Math.max(this.width / bg.naturalWidth, this.height / bg.naturalHeight);
      const w = bg.naturalWidth * s;
      const h = bg.naturalHeight * s;
      ctx.drawImage(bg, (this.width - w) / 2, (this.height - h) / 2, w, h);
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, SCENE.backgroundTop);
    g.addColorStop(1, SCENE.backgroundBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);

    // soft glow behind the well, drifting from calm to danger hue with tension
    const { well, cell } = this.layout;
    const hue = lerp(TENSION_VISUALS.frameCalmHue, TENSION_VISUALS.frameDangerHue + 360, this.tension) % 360;
    const cx = well.x + well.w / 2;
    const cy = well.y + well.h / 2;
    const rg = ctx.createRadialGradient(cx, cy, cell * 2, cx, cy, Math.max(this.width, this.height) * 0.7);
    rg.addColorStop(0, hsla(hue, 70, 30, 0.22 + 0.1 * this.tension));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, this.width, this.height);

    // faint perspective-free grid
    const step = cell * 1.5;
    const off = (now * 0.004) % step;
    ctx.strokeStyle = SCENE.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -off; x < this.width; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.height);
    }
    for (let y = -off; y < this.height; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.width, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  private drawLogo(): void {
    const ctx = this.ctx;
    const { logo, cell, portrait } = this.layout;
    const img = this.assets.get('logo');
    if (img) {
      const s = Math.min(logo.w / img.naturalWidth, logo.h / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, logo.x + (logo.w - w) / 2, logo.y + (logo.h - h) / 2, w, h);
      return;
    }
    const size = Math.round(cell * (portrait ? 1.05 : 1.35));
    ctx.save();
    ctx.font = `700 ${size}px ${SCENE.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = 'TETRISLOP';
    const spacing = size * 0.18;
    const widths = [...text].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
    let x = logo.x + logo.w / 2 - total / 2;
    const y = logo.y + logo.h / 2;
    const order: PieceType[] = ['I', 'J', 'L', 'O', 'S', 'Z', 'T', 'I', 'J'];
    [...text].forEach((ch, i) => {
      const c = PIECE_COLORS[order[i % order.length]];
      ctx.fillStyle = hsla(c.h, c.s, c.l + 14);
      ctx.shadowColor = hsla(c.h, c.s, c.l, 0.55);
      ctx.shadowBlur = size * 0.35;
      ctx.fillText(ch, x + widths[i] / 2, y);
      x += widths[i] + spacing;
    });
    ctx.restore();
  }

  private drawFrame(now: number): void {
    const ctx = this.ctx;
    const { well, cell } = this.layout;
    const pad = Math.round(cell * 0.28);
    const frame = this.assets.get('boardFrame');
    if (frame) {
      ctx.drawImage(frame, well.x - pad * 2, well.y - pad * 2, well.w + pad * 4, well.h + pad * 4);
      return;
    }
    const t = this.tension;
    const pulse = t > 0.5 ? (Math.sin((now / 1000) * Math.PI * 2 * TENSION_VISUALS.pulseHz) + 1) / 2 : 0;
    const hue = lerp(TENSION_VISUALS.frameCalmHue, TENSION_VISUALS.frameDangerHue + 360, t) % 360;
    ctx.save();
    ctx.shadowColor = hsla(hue, 90, 55, 0.55 + 0.35 * pulse * t);
    ctx.shadowBlur = cell * (0.6 + 0.8 * pulse * t);
    ctx.strokeStyle = hsla(hue, 80, 62, 0.85);
    ctx.lineWidth = Math.max(2, cell * 0.08);
    this.roundRect(well.x - pad, well.y - pad, well.w + pad * 2, well.h + pad * 2, cell * 0.3);
    ctx.stroke();
    ctx.restore();
  }

  // ---- well -------------------------------------------------------------------------
  private drawWell(view: RenderView, now: number): void {
    const ctx = this.ctx;
    const { well, cell } = this.layout;
    const hidden = GAME_CONFIG.hiddenRows;

    this.drawFrame(now);
    ctx.fillStyle = SCENE.wellFill;
    ctx.fillRect(well.x, well.y, well.w, well.h);

    // grid
    ctx.strokeStyle = SCENE.wellGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < GAME_CONFIG.cols; c++) {
      ctx.moveTo(well.x + c * cell + 0.5, well.y);
      ctx.lineTo(well.x + c * cell + 0.5, well.y + well.h);
    }
    for (let r = 1; r < GAME_CONFIG.visibleRows; r++) {
      ctx.moveTo(well.x, well.y + r * cell + 0.5);
      ctx.lineTo(well.x + well.w, well.y + r * cell + 0.5);
    }
    ctx.stroke();

    // settled blocks (only visible rows are drawn; the well is clipped)
    ctx.save();
    ctx.beginPath();
    ctx.rect(well.x, well.y - cell * 2, well.w, well.h + cell * 2);
    ctx.clip();

    for (let y = hidden; y < view.grid.length; y++) {
      const row = view.grid[y];
      for (let x = 0; x < row.length; x++) {
        const v = row[x];
        if (v) this.drawCell(well.x + x * cell, well.y + (y - hidden) * cell, cell, PIECE_COLORS[v]);
      }
    }

    this.drawTrails(now);

    if (view.ghost && view.active && view.state !== 'over') {
      for (const c of view.ghost) {
        if (c.y < hidden) continue;
        this.drawGhostCell(well.x + c.x * cell, well.y + (c.y - hidden) * cell, cell, PIECE_COLORS[view.active.type]);
      }
    }
    if (view.active) {
      const dim = -8 * view.lockProgress;
      for (const c of view.active.cells) {
        // pieces in the hidden rows peek over the top edge slightly faded
        const alpha = c.y < hidden ? 0.35 : 1;
        this.drawCell(well.x + c.x * cell, well.y + (c.y - hidden) * cell, cell, PIECE_COLORS[view.active.type], alpha, dim);
      }
    }
    ctx.restore();

    this.drawFlashes(now);
  }

  private drawTrails(now: number): void {
    const ctx = this.ctx;
    const { well, cell } = this.layout;
    const life = 160;
    this.trails = this.trails.filter((t) => now - t.start < life);
    for (const t of this.trails) {
      const k = 1 - (now - t.start) / life;
      const col = PIECE_COLORS[t.type];
      const tops = new Map<number, number>();
      for (const c of t.cells) tops.set(c.x, Math.min(tops.get(c.x) ?? Infinity, c.y));
      for (const [x, y] of tops) {
        const yTop = well.y + (y - GAME_CONFIG.hiddenRows - t.distance) * cell;
        const yBot = well.y + (y - GAME_CONFIG.hiddenRows) * cell;
        const g = ctx.createLinearGradient(0, yTop, 0, yBot);
        g.addColorStop(0, hsla(col.h, col.s, col.l + 20, 0));
        g.addColorStop(1, hsla(col.h, col.s, col.l + 20, 0.35 * k));
        ctx.fillStyle = g;
        ctx.fillRect(well.x + x * cell + cell * 0.15, yTop, cell * 0.7, yBot - yTop);
      }
    }
  }

  private drawFlashes(now: number): void {
    const ctx = this.ctx;
    const { well, cell } = this.layout;
    const life = 260;
    this.flashes = this.flashes.filter((f) => now - f.start < life);
    for (const f of this.flashes) {
      const k = 1 - (now - f.start) / life;
      const grow = (1 - k) * cell * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${0.75 * k * k})`;
      // rows were cleared already; flash the band where they were (bottom aligned)
      f.rows.forEach((r) => {
        ctx.fillRect(well.x - grow, well.y + r * cell + cell * 0.5 * (1 - k), well.w + grow * 2, cell * k);
      });
    }
  }

  // ---- vector cells -------------------------------------------------------------------
  private cellColors(base: HSL) {
    const m = this.modulation;
    const st = CELL_STYLE;
    const h = base.h + m.hueShiftDeg;
    const s = base.s + m.saturationShift;
    const c = m.contrastMultiplier;
    return {
      h,
      s,
      l: base.l,
      border: base.l + st.borderLightness * c,
      inner: base.l + st.innerLightness + m.innerBrightnessOffset,
      highlight: base.l + st.highlightLightness * c,
      highlightS: s + st.highlightSaturation,
      shadow: base.l + st.shadowLightness * c,
    };
  }

  /** One beveled 1x1 cell: border, top/left highlight, bottom/right shadow, inner fill. */
  drawCell(px: number, py: number, size: number, base: HSL, alpha = 1, lightOffset = 0): void {
    const ctx = this.ctx;
    const col = this.cellColors(base);
    const b = Math.max(1, Math.round(size * CELL_STYLE.borderWidthRatio));
    const bev = Math.max(1, Math.round(size * this.modulation.bevelDepthRatio));
    const x0 = px, y0 = py, x1 = px + size, y1 = py + size;
    const ix0 = x0 + b, iy0 = y0 + b, ix1 = x1 - b, iy1 = y1 - b;
    const cx0 = ix0 + bev, cy0 = iy0 + bev, cx1 = ix1 - bev, cy1 = iy1 - bev;
    const lo = lightOffset;

    // 1. outer border
    ctx.fillStyle = hsla(col.h, col.s, col.border + lo, alpha);
    ctx.fillRect(x0, y0, size, size);

    // 3. top + left highlight trapezoids
    ctx.fillStyle = hsla(col.h, col.highlightS, col.highlight + lo, alpha);
    ctx.beginPath();
    ctx.moveTo(ix0, iy0); ctx.lineTo(ix1, iy0); ctx.lineTo(cx1, cy0); ctx.lineTo(cx0, cy0); ctx.closePath();
    ctx.moveTo(ix0, iy0); ctx.lineTo(cx0, cy0); ctx.lineTo(cx0, cy1); ctx.lineTo(ix0, iy1); ctx.closePath();
    ctx.fill();

    // 4. bottom + right shadow trapezoids
    ctx.fillStyle = hsla(col.h, col.s, col.shadow + lo, alpha);
    ctx.beginPath();
    ctx.moveTo(ix0, iy1); ctx.lineTo(cx0, cy1); ctx.lineTo(cx1, cy1); ctx.lineTo(ix1, iy1); ctx.closePath();
    ctx.moveTo(ix1, iy0); ctx.lineTo(ix1, iy1); ctx.lineTo(cx1, cy1); ctx.lineTo(cx1, cy0); ctx.closePath();
    ctx.fill();

    // 2. inner centre fill
    ctx.fillStyle = hsla(col.h, col.s, col.inner + lo, alpha);
    ctx.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  }

  private drawGhostCell(px: number, py: number, size: number, base: HSL): void {
    const ctx = this.ctx;
    const g = CELL_STYLE.ghost;
    const col = this.cellColors(base);
    const b = Math.max(1, Math.round(size * CELL_STYLE.borderWidthRatio));
    const bev = Math.max(1, Math.round(size * this.modulation.bevelDepthRatio * 0.6));
    const ix0 = px + b, iy0 = py + b, ix1 = px + size - b, iy1 = py + size - b;

    ctx.fillStyle = hsla(col.h, col.s, col.l, g.fillAlpha);
    ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);

    ctx.fillStyle = hsla(col.h, col.highlightS, col.highlight, g.bevelAlpha);
    ctx.beginPath();
    ctx.moveTo(ix0, iy0); ctx.lineTo(ix1, iy0); ctx.lineTo(ix1 - bev, iy0 + bev); ctx.lineTo(ix0 + bev, iy0 + bev); ctx.closePath();
    ctx.moveTo(ix0, iy0); ctx.lineTo(ix0 + bev, iy0 + bev); ctx.lineTo(ix0 + bev, iy1 - bev); ctx.lineTo(ix0, iy1); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = hsla(col.h, col.s, col.shadow, g.bevelAlpha);
    ctx.beginPath();
    ctx.moveTo(ix0, iy1); ctx.lineTo(ix0 + bev, iy1 - bev); ctx.lineTo(ix1 - bev, iy1 - bev); ctx.lineTo(ix1, iy1); ctx.closePath();
    ctx.moveTo(ix1, iy0); ctx.lineTo(ix1, iy1); ctx.lineTo(ix1 - bev, iy1 - bev); ctx.lineTo(ix1 - bev, iy0 + bev); ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = hsla(col.h, col.s, col.l + 12, g.borderAlpha);
    ctx.lineWidth = b;
    ctx.strokeRect(px + b / 2, py + b / 2, size - b, size - b);
  }

  /** Draws a piece in spawn orientation centred inside a box. */
  private drawMiniPiece(type: PieceType, cx: number, cy: number, cellSize: number, alpha = 1): void {
    const cells = localCells(type, 0);
    const minX = Math.min(...cells.map((c) => c.x));
    const maxX = Math.max(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const maxY = Math.max(...cells.map((c) => c.y));
    const w = (maxX - minX + 1) * cellSize;
    const h = (maxY - minY + 1) * cellSize;
    const ox = Math.round(cx - w / 2);
    const oy = Math.round(cy - h / 2);
    for (const c of cells) {
      this.drawCell(ox + (c.x - minX) * cellSize, oy + (c.y - minY) * cellSize, cellSize, PIECE_COLORS[type], alpha);
    }
  }

  // ---- panels ---------------------------------------------------------------------------
  private drawPanel(r: Rect, title: string): void {
    const ctx = this.ctx;
    const { cell } = this.layout;
    ctx.save();
    ctx.fillStyle = SCENE.panelFill;
    ctx.strokeStyle = SCENE.panelStroke;
    ctx.lineWidth = 1;
    this.roundRect(r.x, r.y, r.w, r.h, cell * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = SCENE.textMuted;
    ctx.font = `600 ${Math.round(cell * 0.42)}px ${SCENE.fontFamily}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(title, r.x + cell * 0.4, r.y + cell * 0.35);
    ctx.restore();
  }

  private drawNext(view: RenderView): void {
    const { next, cell, portrait } = this.layout;
    this.drawPanel(next, 'NEXT');
    const sizes = portrait ? [0.72, 0.55, 0.55] : [0.9, 0.7, 0.7];
    const slotH = portrait ? [2.6, 2.2, 2.2] : [3.4, 2.9, 2.9];
    let y = next.y + cell * 1.1;
    view.nextQueue.slice(0, GAME_CONFIG.previewCount).forEach((type, i) => {
      const h = slotH[i] * cell;
      this.drawMiniPiece(type, next.x + next.w / 2, y + h / 2, Math.round(cell * sizes[i]), i === 0 ? 1 : 0.85);
      y += h;
    });
  }

  private drawStats(view: RenderView): void {
    const ctx = this.ctx;
    const { stats, cell, portrait } = this.layout;
    this.drawPanel(stats, 'STATS');
    const rows: Array<[string, string, boolean]> = [
      ['SCORE', view.score.toLocaleString('en-US'), false],
      ['LEVEL', String(view.level), false],
      ['LINES', String(view.lines), false],
      ['MOVES', String(view.moves), false],
      ['COMBO', view.combo > 0 ? `x${view.combo}` : '–', view.combo > 0],
      ['B2B', view.b2b > 0 ? `x${view.b2b}` : '–', view.b2b > 0],
    ];
    const lineH = portrait ? cell * 1.45 : cell * 1.65;
    const labelSize = Math.round(cell * (portrait ? 0.36 : 0.4));
    const valueSize = Math.round(cell * (portrait ? 0.62 : 0.78));
    let y = stats.y + cell * 1.2;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const [label, value, hot] of rows) {
      ctx.fillStyle = SCENE.textMuted;
      ctx.font = `500 ${labelSize}px ${SCENE.fontFamily}`;
      ctx.fillText(label, stats.x + cell * 0.4, y);
      ctx.fillStyle = hot ? '#ffd166' : SCENE.textPrimary;
      ctx.font = `600 ${valueSize}px ${SCENE.monoFamily}`;
      ctx.fillText(this.fit(value, stats.w - cell * 0.8, valueSize), stats.x + cell * 0.4, y + labelSize * 1.15);
      y += lineH;
    }

    // footer: upload + audio status
    const statusText: Record<UploadStatus, [string, string]> = {
      idle: ['● recording', '#6b7399'],
      sending: ['● saving…', '#ffd166'],
      saved: ['● saved', '#5be49b'],
      failed: ['● offline – retry later', '#ff6b6b'],
      local: ['● local only (console)', '#8a93b8'],
      skipped: ['● too short – not saved', '#8a93b8'],
    };
    const [txt, color] = statusText[view.uploadStatus];
    ctx.font = `500 ${Math.round(cell * 0.34)}px ${SCENE.fontFamily}`;
    ctx.fillStyle = color;
    ctx.fillText(txt, stats.x + cell * 0.4, stats.y + stats.h - cell * 1.15);
    ctx.fillStyle = SCENE.textMuted;
    ctx.fillText(view.muted ? '♪ muted (M)' : '♪ sound on (M)', stats.x + cell * 0.4, stats.y + stats.h - cell * 0.65);
    ctx.restore();
  }

  private fit(text: string, maxW: number, size: number): string {
    // shrink-to-fit by trimming the font size via scale would blur; long scores are rare
    const ctx = this.ctx;
    if (ctx.measureText(text).width <= maxW) return text;
    ctx.font = `600 ${Math.round(size * 0.75)}px ${SCENE.monoFamily}`;
    return text;
  }

  // ---- floating texts / vignette / overlays ---------------------------------------------------
  private drawFloatingTexts(now: number): void {
    const ctx = this.ctx;
    const { well, cell } = this.layout;
    const life = 1100;
    this.floating = this.floating.filter((f) => now - f.start < life);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.floating.forEach((f, i) => {
      const t = (now - f.start) / life;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const size = Math.round(cell * (f.big ? 1.15 : 0.8) * (1 + 0.15 * (1 - Math.min(1, t * 4))));
      ctx.font = `700 ${size}px ${SCENE.fontFamily}`;
      ctx.fillStyle = hsla(f.hue, 95, 70, alpha);
      ctx.shadowColor = hsla(f.hue, 95, 50, alpha * 0.8);
      ctx.shadowBlur = cell * 0.6;
      const y = well.y + well.h * 0.38 + i * cell * 1.1 - t * cell * 1.6;
      ctx.fillText(f.text, well.x + well.w / 2, y);
    });
    ctx.restore();
  }

  private drawVignette(now: number): void {
    if (this.tension < 0.05) return;
    const ctx = this.ctx;
    const pulse = (Math.sin((now / 1000) * Math.PI * 2 * TENSION_VISUALS.pulseHz) + 1) / 2;
    const a = TENSION_VISUALS.vignetteMaxAlpha * this.tension * (0.75 + 0.25 * pulse);
    const g = ctx.createRadialGradient(
      this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35,
      this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75,
    );
    g.addColorStop(0, 'rgba(120,0,10,0)');
    g.addColorStop(1, `rgba(150,0,20,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawOverlay(view: RenderView, now: number): void {
    if (view.state === 'playing') return;
    const ctx = this.ctx;
    const { well, cell } = this.layout;
    ctx.save();
    ctx.fillStyle = 'rgba(4, 6, 14, 0.78)';
    ctx.fillRect(well.x, well.y, well.w, well.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = well.x + well.w / 2;
    let y = well.y + well.h * 0.3;
    const title = (text: string, hue: number) => {
      ctx.font = `700 ${Math.round(cell * 1.1)}px ${SCENE.fontFamily}`;
      ctx.fillStyle = hsla(hue, 95, 68);
      ctx.shadowColor = hsla(hue, 95, 50, 0.8);
      ctx.shadowBlur = cell * 0.7;
      ctx.fillText(text, cx, y);
      ctx.shadowBlur = 0;
      y += cell * 1.5;
    };
    const line = (text: string, color: string = SCENE.textPrimary, scale = 0.46) => {
      ctx.font = `500 ${Math.round(cell * scale)}px ${SCENE.fontFamily}`;
      ctx.fillStyle = color;
      ctx.fillText(text, cx, y);
      y += cell * scale * 1.75;
    };
    const blink = Math.floor(now / 550) % 2 === 0;

    if (view.state === 'ready') {
      title('READY?', 190);
      line(view.touchMode ? 'Tap START to play' : 'Press ENTER or any key', blink ? SCENE.textPrimary : SCENE.textMuted, 0.5);
      y += cell * 0.6;
      const keys: Array<[string, string]> = view.touchMode
        ? [['◀ ▶', 'move'], ['⟲ ⟳', 'rotate'], ['▼', 'soft drop'], ['⤓', 'hard drop']]
        : [['← →', 'move'], ['↑ / X', 'rotate right'], ['Z / Y / Ctrl', 'rotate left'], ['↓', 'soft drop'], ['Space', 'hard drop'], ['P / Esc', 'pause'], ['R', 'restart'], ['M', 'mute']];
      for (const [k, d] of keys) line(`${k}  ·  ${d}`, SCENE.textMuted, 0.36);
      y += cell * 0.4;
      line('Every game is recorded anonymously', SCENE.textMuted, 0.3);
      line('for a deep-learning research project.', SCENE.textMuted, 0.3);
    } else if (view.state === 'paused') {
      title('PAUSED', 50);
      line(view.touchMode ? 'Tap ❚❚ to continue' : 'Press P / Esc to continue', SCENE.textMuted);
    } else if (view.state === 'over') {
      title('TOP OUT', 0);
      line(`Score  ${view.score.toLocaleString('en-US')}`, SCENE.textPrimary, 0.55);
      line(`Lines ${view.lines}  ·  Level ${view.level}  ·  Moves ${view.moves}`, SCENE.textMuted, 0.38);
      y += cell * 0.4;
      const status: Record<UploadStatus, [string, string]> = {
        idle: ['', SCENE.textMuted],
        sending: ['Saving game…', '#ffd166'],
        saved: ['Game saved ✓ thanks!', '#5be49b'],
        failed: ['Offline – will retry on next visit', '#ff6b6b'],
        local: ['Not uploaded (no Supabase config)', SCENE.textMuted],
        skipped: ['Too short to record', SCENE.textMuted],
      };
      const [s, c] = status[view.uploadStatus];
      if (s) line(s, c, 0.4);
      y += cell * 0.6;
      line(view.touchMode ? 'Tap ↻ to play again' : 'Press R or ENTER to play again', blink ? SCENE.textPrimary : SCENE.textMuted, 0.46);
    }
    ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
