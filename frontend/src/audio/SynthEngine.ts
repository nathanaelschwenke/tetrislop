import {
  SYNTH_GLOBAL,
  SYNTH_PRESETS,
  SYNTH_SEQUENCES,
  type SoundName,
  type SoundPreset,
} from '../config/synthConfig';

export interface PlayOptions {
  /** Pitch offset in semitones relative to the preset. */
  semitones?: number;
  /** Peak gain multiplier. */
  gainScale?: number;
  /** Start offset in ms (for arpeggios / sequences). */
  delayMs?: number;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Live procedural synthesizer built on the native Web Audio API.
 * Signal chain per voice: Oscillator (+LFO on frequency) -> BiquadFilter ->
 * envelope Gain -> master Gain -> DynamicsCompressor -> destination.
 * No samples, no external libraries.
 */
export class SynthEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private presets: Record<SoundName, SoundPreset>;
  private tension = 0;
  private muted = false;
  private masterGain = SYNTH_GLOBAL.masterGain;

  constructor() {
    this.presets = structuredClone(SYNTH_PRESETS);
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const c = SYNTH_GLOBAL.compressor;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = c.thresholdDb;
      comp.knee.value = c.kneeDb;
      comp.ratio.value = c.ratio;
      comp.attack.value = c.attackS;
      comp.release.value = c.releaseS;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.masterGain;
      this.master.connect(comp);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.masterGain, this.ctx.currentTime, 0.02);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMasterVolume(v: number): void {
    this.masterGain = clamp(v, 0, 1);
    this.setMuted(this.muted);
  }

  /** Suspend audio processing (e.g. while the tab is hidden). */
  suspend(): void { if (this.ctx?.state === 'running') void this.ctx.suspend(); }
  resume(): void { if (this.ctx?.state === 'suspended') void this.ctx.resume(); }

  /**
   * Global tension 0..1: raises pitch, opens the filter and adds vibrato.
   * Phase 2 will drive this from the survival prediction.
   */
  setTensionState(tension: number): void {
    this.tension = clamp(tension, 0, 1);
  }

  get tensionState(): number { return this.tension; }

  /** Runtime modulation of a single preset (deep-merged). */
  setPresetParams(name: SoundName, params: DeepPartial<SoundPreset>): void {
    const p = this.presets[name];
    const { envelope, filter, modulation, ...flat } = params;
    Object.assign(p, flat);
    if (envelope) Object.assign(p.envelope, envelope);
    if (filter) Object.assign(p.filter, filter);
    if (modulation) Object.assign(p.modulation, modulation);
  }

  getPreset(name: SoundName): Readonly<SoundPreset> { return this.presets[name]; }

  resetPresets(): void { this.presets = structuredClone(SYNTH_PRESETS); }

  play(name: SoundName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') return;
    const p = this.presets[name];
    const t = this.tension;
    const tg = SYNTH_GLOBAL.tension;

    const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const dur = p.durationMs / 1000;
    const env = p.envelope;
    const a = env.attackMs / 1000;
    const d = env.decayMs / 1000;
    const r = env.releaseMs / 1000;
    const peak = clamp(p.gain * (opts.gainScale ?? 1), 0, 1);
    const sustain = peak * clamp(env.sustainLevel, 0, 1);

    const pitchRatio = Math.pow(2, (opts.semitones ?? 0) / 12);
    const f0 = Math.max(20, p.baseFrequencyHz * pitchRatio);
    const f1 = Math.max(20, (p.baseFrequencyHz + p.pitchSlideHz) * pitchRatio);

    // ---- oscillator -----------------------------------------------------------
    const osc = ctx.createOscillator();
    osc.type = p.waveform;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t0 + Math.max(dur, 0.005));
    osc.detune.value = p.modulation.detuneCents + t * tg.pitchShiftCents;

    // ---- LFO (vibrato) ------------------------------------------------------------
    const lfoRate = p.modulation.lfoFrequencyHz + t * tg.extraLfoRateHz;
    const lfoDepth = p.modulation.lfoDepth + t * tg.extraLfoDepthHz;
    let lfo: OscillatorNode | null = null;
    if (lfoRate > 0 && lfoDepth > 0) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = lfoDepth;
      lfo.connect(lfoGain).connect(osc.frequency);
    }

    // ---- filter -------------------------------------------------------------------
    const filter = ctx.createBiquadFilter();
    filter.type = p.filter.type;
    filter.frequency.value = clamp(p.filter.cutoffHz * (1 + t * (tg.cutoffMultiplier - 1)), 20, ctx.sampleRate / 2 - 100);
    filter.Q.value = p.filter.resonanceQ;

    // ---- ADSR envelope -----------------------------------------------------------
    const vca = ctx.createGain();
    const g = vca.gain;
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(peak, t0 + a);
    g.linearRampToValueAtTime(sustain, t0 + a + d);
    const releaseStart = Math.max(t0 + a + d, t0 + dur);
    g.setValueAtTime(sustain, releaseStart);
    g.linearRampToValueAtTime(0, releaseStart + r);

    osc.connect(filter).connect(vca).connect(this.master);
    const stopAt = releaseStart + r + 0.02;
    osc.start(t0);
    osc.stop(stopAt);
    if (lfo) {
      lfo.start(t0);
      lfo.stop(stopAt);
    }
    osc.onended = () => {
      osc.disconnect();
      vca.disconnect();
      filter.disconnect();
      lfo?.disconnect();
    };
  }

  // ---- game-specific compositions -------------------------------------------------
  playLineClear(lines: number): void {
    this.play('lineClear', { semitones: (lines - 1) * SYNTH_SEQUENCES.lineClearSemitonesPerLine });
  }

  playTetris(b2b: boolean): void {
    const base = b2b ? SYNTH_SEQUENCES.b2bSemitones : 0;
    SYNTH_SEQUENCES.tetrisArpeggio.forEach((semi, i) =>
      this.play('tetrisClear', { semitones: base + semi, delayMs: i * SYNTH_SEQUENCES.tetrisArpeggioStepMs }),
    );
  }

  playCombo(combo: number): void {
    const step = Math.min(combo, SYNTH_SEQUENCES.comboMaxSteps);
    this.play('combo', { semitones: step * SYNTH_SEQUENCES.comboSemitonesPerStep, delayMs: 60 });
  }

  playPerfectClear(): void {
    [0, 7, 12, 16, 19, 24].forEach((semi, i) =>
      this.play('combo', { semitones: semi + SYNTH_SEQUENCES.b2bSemitones, delayMs: 120 + i * 55, gainScale: 0.9 }),
    );
  }
}
