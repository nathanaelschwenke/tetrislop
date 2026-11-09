import { focusHighlighted } from './focusNav';
import { DEVICE_NAMES } from './icons';
import { PIECE_COLORS } from '../config/visualConfig';
import { pickTagline } from '../config/taglines';
import type { PieceType } from '../core/Tetromino';
import type { DbStatus } from '../telemetry/dbPing';

export type MenuDevice = 'keyboard' | 'touch' | 'gamepad';

export interface MainMenuHandlers {
  play(): void;
  toggleMute(): void;
  toggleDevice(): void;
  recheckDb(): void;
}

const DB_TEXT: Record<DbStatus, string> = {
  checking: 'Datenbank wird geprüft…',
  online: 'Datenbank verbunden',
  offline: 'Datenbank offline – Spiele werden später nachgereicht',
  unconfigured: 'Keine Datenbank konfiguriert – Spiele nur in der Konsole',
};

const DEVICE_HINT: Record<MenuDevice, string> = {
  keyboard: 'Enter zum Starten · ← → bewegen · ↑ drehen · Leertaste Hard Drop',
  touch: 'Gesteuert wird mit den Tasten unter dem Spielfeld',
  gamepad: 'A / Start zum Starten · Steuerkreuz bewegen · A / B drehen · ↑ Hard Drop',
};



/**
 * DOM title screen: big play button, info popup, mute + input-method icons
 * and the database connection indicator. Holds no game state itself.
 */
export class MainMenu {
  private readonly root: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly inputBtn: HTMLButtonElement;
  private readonly inputHint: HTMLElement;
  private readonly dbBtn: HTMLButtonElement;
  private readonly dialog: HTMLDialogElement;

  constructor(handlers: MainMenuHandlers) {
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    this.root = $('menu');
    this.playBtn = $('play-btn');
    this.muteBtn = $('mute-btn');
    this.inputBtn = $('input-btn');
    this.inputHint = $('input-hint');
    this.dbBtn = $('db-status');
    this.dialog = $('info-dialog');

    this.buildLogo();
    (this.root.querySelector('.menu-tag') as HTMLElement).textContent = pickTagline();
    this.playBtn.addEventListener('click', () => handlers.play());
    this.muteBtn.addEventListener('click', () => handlers.toggleMute());
    this.inputBtn.addEventListener('click', () => handlers.toggleDevice());
    this.dbBtn.addEventListener('click', () => handlers.recheckDb());
    $('info-btn').addEventListener('click', () => this.openInfo());
    // click on the backdrop closes the popup
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) {
        const r = this.dialog.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) this.dialog.close();
      }
    });
  }

  /** Root element (for controller focus navigation). */
  get element(): HTMLElement {
    return this.root;
  }

  get dialogElement(): HTMLDialogElement {
    return this.dialog;
  }

  /** Scrolls the info popup (controller up/down). */
  scrollInfo(direction: -1 | 1): void {
    this.dialog.scrollBy({ top: direction * 120, behavior: 'smooth' });
  }

  /** True while the info popup is open (menu keys must not start the game). */
  get infoOpen(): boolean {
    return this.dialog.open;
  }

  focusPlay(): void {
    focusHighlighted(this.playBtn);
  }

  openInfo(): void {
    if (this.dialog.open) return;
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.dialog.scrollTop = 0;
  }

  closeInfo(): void {
    if (this.dialog.open) this.dialog.close();
  }

  setMuted(muted: boolean): void {
    this.muteBtn.setAttribute('aria-pressed', String(muted));
    this.muteBtn.setAttribute('aria-label', muted ? 'Ton einschalten' : 'Ton ausschalten');
    this.label(this.muteBtn, muted ? 'Ton aus' : 'Ton an');
  }

  setDevice(device: MenuDevice, manual: boolean): void {
    this.inputBtn.dataset.device = device;
    const name = DEVICE_NAMES[device];
    this.label(this.inputBtn, name);
    this.inputBtn.title = `${manual ? 'Gewählt' : 'Erkannt'}: ${name} – klicken zum Wechseln`;
    this.inputBtn.setAttribute('aria-label', `Eingabemethode: ${name}. Wechseln`);
    this.inputHint.textContent = DEVICE_HINT[device];
  }

  setDbStatus(status: DbStatus): void {
    this.dbBtn.dataset.state = status;
    (this.dbBtn.querySelector('.db-text') as HTMLElement).textContent = DB_TEXT[status];
  }

  private label(btn: HTMLElement, text: string): void {
    (btn.querySelector('.icon-label') as HTMLElement).textContent = text;
  }

  /** Replaces the lettering with the user-provided /assets/ui/logo.png. */
  setLogoImage(img: HTMLImageElement): void {
    img.alt = 'TetriSlop';
    (this.root.querySelector('.menu-logo') as HTMLElement).replaceChildren(img);
  }

  /** Fallback logo: piece-coloured letters. */
  private buildLogo(): void {
    const h1 = this.root.querySelector('.menu-logo') as HTMLElement;
    const order: PieceType[] = ['I', 'J', 'L', 'O', 'S', 'Z', 'T', 'I', 'J'];
    [...'TETRISLOP'].forEach((ch, i) => {
      const c = PIECE_COLORS[order[i]];
      const span = document.createElement('span');
      span.textContent = ch;
      span.style.color = `hsl(${c.h} ${c.s}% ${Math.min(90, c.l + 14)}%)`;
      span.style.textShadow = `0 0 0.3em hsla(${c.h}, ${c.s}%, ${c.l}%, 0.6)`;
      span.setAttribute('aria-hidden', 'true');
      h1.appendChild(span);
    });
  }
}
