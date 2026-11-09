/**
 * "Install app" support.
 *  - Chrome / Edge / Android fire `beforeinstallprompt`; we keep the event and
 *    show the browser's install dialog when the player clicks our button.
 *  - iOS has no such event: the button opens a short "Teilen → Zum Home-Bildschirm" guide.
 *  - Already installed (running standalone) or no install support: no button.
 */
export type InstallMode = 'prompt' | 'ios' | null;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function runningStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, but has touch
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export class InstallPrompt {
  private deferred: BeforeInstallPromptEvent | null = null;
  private installed = runningStandalone();

  constructor(private readonly onChange: (mode: InstallMode) => void) {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // we show our own button instead of the mini-infobar
      this.deferred = e as BeforeInstallPromptEvent;
      this.onChange(this.mode);
    });
    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this.deferred = null;
      this.onChange(this.mode);
    });
    this.onChange(this.mode);
  }

  get mode(): InstallMode {
    if (this.installed) return null;
    if (this.deferred) return 'prompt';
    return isIos() ? 'ios' : null;
  }

  /** Shows the browser's install dialog ('prompt' mode). Resolves to whether it was accepted. */
  async prompt(): Promise<boolean> {
    const e = this.deferred;
    if (!e) return false;
    this.deferred = null; // an event can only be prompted once
    await e.prompt();
    const { outcome } = await e.userChoice;
    this.onChange(this.mode);
    return outcome === 'accepted';
  }
}
