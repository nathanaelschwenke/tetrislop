import { focusHighlighted } from './focusNav';
import { DEVICE_ICONS, DEVICE_NAMES } from './icons';
import type { InputDevice } from '../core/types';
import type { UploadStatus } from '../telemetry/DataLogger';

export interface GamePanelHandlers {
  resume(): void;
  retry(): void;
  toMenu(): void;
}

export interface GameSummary {
  score: number;
  lines: number;
  level: number;
}

const HINTS: Record<'paused' | 'over', Partial<Record<InputDevice, string>>> = {
  paused: { keyboard: 'P / Esc: weiter · R: Neustart', gamepad: 'Start / B: weiter' },
  over: { keyboard: 'Enter / R: nochmal · Esc: Hauptmenü', gamepad: 'Start: nochmal · B: Hauptmenü' },
};

interface Rect { x: number; y: number; w: number; h: number }

const UPLOAD_TEXT: Record<UploadStatus, [string, string]> = {
  idle: ['', ''],
  sending: ['Spiel wird gespeichert…', 'var(--amber)'],
  saved: ['Gespeichert ✓ Danke!', 'var(--ok)'],
  failed: ['Offline – wird beim nächsten Besuch gesendet', 'var(--red)'],
  local: ['Nicht hochgeladen (keine Datenbank konfiguriert)', 'var(--muted)'],
  skipped: ['Zu kurz – nicht gespeichert', 'var(--muted)'],
};

/**
 * DOM panel laid over the well while the game is paused or over, so the
 * player can resume, retry or go back to the main menu by click/tap.
 */
export class GamePanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly score: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly upload: HTMLElement;
  private readonly buttons: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly device: HTMLElement;
  private mode: 'paused' | 'over' | null = null;
  private lockTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRect = '';

  constructor(private readonly handlers: GamePanelHandlers) {
    this.root = document.getElementById('game-panel') as HTMLElement;
    const q = (sel: string) => this.root.querySelector(sel) as HTMLElement;
    this.title = q('.panel-title');
    this.score = q('.panel-score');
    this.stats = q('.panel-stats');
    this.upload = q('.panel-upload');
    this.buttons = q('.panel-buttons');
    this.hint = q('.panel-hint');
    this.device = q('.panel-device');
  }

  get current(): 'paused' | 'over' | null {
    return this.mode;
  }

  get element(): HTMLElement {
    return this.root;
  }

  /** Focuses the highlighted button (controller navigation starts there). */
  focusPrimary(): void {
    const btn = this.buttons.querySelector('button');
    if (btn) focusHighlighted(btn);
  }

  show(mode: 'paused' | 'over', summary: GameSummary, device: InputDevice): void {
    this.mode = mode;
    this.buttons.replaceChildren();
    this.device.replaceChildren();
    if (mode === 'paused') {
      this.root.style.setProperty('--panel-hue', 'var(--amber)');
      this.title.textContent = 'PAUSE';
      this.score.textContent = '';
      this.stats.textContent = '';
      this.upload.textContent = '';
      this.addButton('Weiter', true, this.handlers.resume);
      this.addButton('Neustart', false, this.handlers.retry);
      this.addButton('Hauptmenü', false, this.handlers.toMenu);
      this.showDevice(device);
    } else {
      this.root.style.setProperty('--panel-hue', 'var(--red)');
      this.title.textContent = 'TOP OUT';
      this.score.textContent = `Score ${summary.score.toLocaleString('de-DE')}`;
      this.stats.textContent = `Lines ${summary.lines} · Level ${summary.level}`;
      this.addButton('Nochmal', true, this.handlers.retry);
      this.addButton('Hauptmenü', false, this.handlers.toMenu);
    }
    this.hint.textContent = HINTS[mode][device] ?? '';
    this.root.hidden = false;
  }

  /** Disables the buttons for `ms` (accidental-restart guard), then calls onUnlock. */
  lock(ms: number, onUnlock?: () => void): void {
    const buttons = [...this.buttons.querySelectorAll('button')];
    buttons.forEach((b) => { b.disabled = true; });
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => {
      buttons.forEach((b) => { b.disabled = false; });
      if (this.mode) onUnlock?.();
    }, ms);
  }

  /** Greyed-out chip with the locked input method (it can only change in the main menu). */
  private showDevice(device: InputDevice): void {
    if (device === 'mixed') return;
    const chip = document.createElement('span');
    chip.className = 'device-chip';
    chip.innerHTML = DEVICE_ICONS[device];
    chip.append(DEVICE_NAMES[device]);
    chip.setAttribute('aria-disabled', 'true');
    const note = document.createElement('span');
    note.className = 'device-note';
    note.textContent = 'Wechsel nur im Hauptmenü';
    this.device.append(chip, note);
  }

  hide(): void {
    this.mode = null;
    clearTimeout(this.lockTimer);
    // A clicked panel button keeps focus while hidden and would swallow Enter/Space.
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
    this.root.hidden = true;
  }

  setUpload(status: UploadStatus): void {
    if (this.mode !== 'over') return;
    const [text, color] = UPLOAD_TEXT[status];
    this.upload.textContent = text;
    this.upload.style.color = color;
  }

  /** Aligns the panel with the well (canvas CSS pixels; canvas sits at 0,0 of #stage). */
  position(r: Rect): void {
    const key = `${r.x},${r.y},${r.w},${r.h}`;
    if (key === this.lastRect) return;
    this.lastRect = key;
    Object.assign(this.root.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }

  private addButton(label: string, primary: boolean, onClick: () => void): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'ui-btn primary' : 'ui-btn';
    b.textContent = label;
    b.addEventListener('click', () => onClick());
    this.buttons.appendChild(b);
  }
}
