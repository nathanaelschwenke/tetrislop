/**
 * Loads optional, user-provided UI graphics from /assets/ui/.
 * Missing files are not an error: the renderer falls back to canvas drawing.
 * Tetromino blocks are NEVER loaded from images (always vector rendered).
 */

export type UiAssetName = 'background' | 'boardFrame' | 'logo';

const ASSET_PATHS: Record<UiAssetName, string> = {
  background: 'assets/ui/background.png',
  boardFrame: 'assets/ui/board_frame.png',
  logo: 'assets/ui/logo.png',
};

export class AssetLoader {
  private images = new Map<UiAssetName, HTMLImageElement>();

  constructor(private readonly baseUrl: string = '/') {}

  async loadAll(): Promise<void> {
    await Promise.all(
      (Object.keys(ASSET_PATHS) as UiAssetName[]).map((name) => this.load(name)),
    );
  }

  private load(name: UiAssetName): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (img.naturalWidth > 0) this.images.set(name, img);
        resolve();
      };
      img.onerror = () => resolve(); // fallback rendering will be used
      img.src = this.baseUrl + ASSET_PATHS[name];
    });
  }

  get(name: UiAssetName): HTMLImageElement | null {
    return this.images.get(name) ?? null;
  }

  has(name: UiAssetName): boolean {
    return this.images.has(name);
  }
}
