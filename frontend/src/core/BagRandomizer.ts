import { PIECE_TYPES, type PieceType } from './Tetromino';

export type RandomFn = () => number;

/**
 * Strict 7-bag randomizer: all seven tetrominoes are shuffled and dealt
 * one after another before a new bag is generated. Keeps enough pieces
 * buffered so that the preview queue is always full.
 */
export class BagRandomizer {
  private queue: PieceType[] = [];

  constructor(
    private readonly previewCount: number,
    private readonly random: RandomFn = Math.random,
  ) {
    this.refill();
  }

  reset(): void {
    this.queue = [];
    this.refill();
  }

  private refill(): void {
    while (this.queue.length <= this.previewCount) {
      const bag = [...PIECE_TYPES];
      // Fisher-Yates
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.queue.push(...bag);
    }
  }

  /** Takes the next piece out of the queue. */
  next(): PieceType {
    const piece = this.queue.shift()!;
    this.refill();
    return piece;
  }

  /** The upcoming pieces shown in the preview (does not consume). */
  peek(count = this.previewCount): PieceType[] {
    return this.queue.slice(0, count);
  }
}

/** Small deterministic PRNG (mulberry32) – handy for tests and replays. */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
