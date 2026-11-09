/**
 * All sound definitions for the procedural Web Audio synthesizer.
 * Every field can be tweaked here or modulated at runtime via
 * SynthEngine.setPresetParams(name, partial).
 */

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';

export interface Envelope {
  attackMs: number;
  decayMs: number;
  sustainLevel: number; // 0..1 of peak gain
  releaseMs: number;
}

export interface FilterParams {
  type: BiquadFilterType;
  cutoffHz: number;
  resonanceQ: number;
}

export interface ModulationParams {
  lfoFrequencyHz: number;
  lfoDepth: number; // vibrato depth in Hz (frequency deviation)
  detuneCents: number;
}

export interface SoundPreset {
  waveform: Waveform;
  baseFrequencyHz: number;
  pitchSlideHz: number; // frequency delta reached at the end of durationMs
  durationMs: number; // time until release starts
  gain: number; // peak gain 0..1
  envelope: Envelope;
  filter: FilterParams;
  modulation: ModulationParams;
}

export type SoundName =
  | 'move'
  | 'rotate'
  | 'softDrop'
  | 'hardDrop'
  | 'lock'
  | 'lineClear'
  | 'tetrisClear'
  | 'combo'
  | 'gameOver';

export const SYNTH_PRESETS: Record<SoundName, SoundPreset> = {
  move: {
    waveform: 'triangle',
    baseFrequencyHz: 520,
    pitchSlideHz: -40,
    durationMs: 18,
    gain: 0.16,
    envelope: { attackMs: 1, decayMs: 14, sustainLevel: 0.25, releaseMs: 25 },
    filter: { type: 'lowpass', cutoffHz: 3200, resonanceQ: 0.7 },
    modulation: { lfoFrequencyHz: 0, lfoDepth: 0, detuneCents: 0 },
  },
  rotate: {
    waveform: 'square',
    baseFrequencyHz: 660,
    pitchSlideHz: 220,
    durationMs: 30,
    gain: 0.09,
    envelope: { attackMs: 1, decayMs: 22, sustainLevel: 0.3, releaseMs: 35 },
    filter: { type: 'lowpass', cutoffHz: 2600, resonanceQ: 3 },
    modulation: { lfoFrequencyHz: 0, lfoDepth: 0, detuneCents: 6 },
  },
  softDrop: {
    waveform: 'sine',
    baseFrequencyHz: 240,
    pitchSlideHz: -60,
    durationMs: 14,
    gain: 0.08,
    envelope: { attackMs: 1, decayMs: 10, sustainLevel: 0.2, releaseMs: 18 },
    filter: { type: 'lowpass', cutoffHz: 1400, resonanceQ: 0.7 },
    modulation: { lfoFrequencyHz: 0, lfoDepth: 0, detuneCents: 0 },
  },
  hardDrop: {
    waveform: 'sawtooth',
    baseFrequencyHz: 190,
    pitchSlideHz: -150,
    durationMs: 70,
    gain: 0.26,
    envelope: { attackMs: 1, decayMs: 60, sustainLevel: 0.15, releaseMs: 90 },
    filter: { type: 'lowpass', cutoffHz: 1800, resonanceQ: 6 },
    modulation: { lfoFrequencyHz: 0, lfoDepth: 0, detuneCents: -8 },
  },
  lock: {
    waveform: 'triangle',
    baseFrequencyHz: 140,
    pitchSlideHz: -50,
    durationMs: 40,
    gain: 0.22,
    envelope: { attackMs: 1, decayMs: 35, sustainLevel: 0.2, releaseMs: 60 },
    filter: { type: 'lowpass', cutoffHz: 900, resonanceQ: 2 },
    modulation: { lfoFrequencyHz: 0, lfoDepth: 0, detuneCents: 0 },
  },
  lineClear: {
    waveform: 'square',
    baseFrequencyHz: 523.25, // C5
    pitchSlideHz: 260,
    durationMs: 120,
    gain: 0.14,
    envelope: { attackMs: 4, decayMs: 80, sustainLevel: 0.45, releaseMs: 160 },
    filter: { type: 'lowpass', cutoffHz: 4200, resonanceQ: 4 },
    modulation: { lfoFrequencyHz: 14, lfoDepth: 9, detuneCents: 7 },
  },
  tetrisClear: {
    waveform: 'sawtooth',
    baseFrequencyHz: 392, // G4, played as an arpeggio
    pitchSlideHz: 0,
    durationMs: 110,
    gain: 0.16,
    envelope: { attackMs: 3, decayMs: 70, sustainLevel: 0.55, releaseMs: 220 },
    filter: { type: 'lowpass', cutoffHz: 3600, resonanceQ: 5 },
    modulation: { lfoFrequencyHz: 6, lfoDepth: 6, detuneCents: 12 },
  },
  combo: {
    waveform: 'triangle',
    baseFrequencyHz: 659.25, // E5, raised per combo step
    pitchSlideHz: 120,
    durationMs: 70,
    gain: 0.18,
    envelope: { attackMs: 2, decayMs: 50, sustainLevel: 0.4, releaseMs: 120 },
    filter: { type: 'bandpass', cutoffHz: 2400, resonanceQ: 1.4 },
    modulation: { lfoFrequencyHz: 18, lfoDepth: 12, detuneCents: 0 },
  },
  gameOver: {
    waveform: 'sawtooth',
    baseFrequencyHz: 330,
    pitchSlideHz: -260,
    durationMs: 1100,
    gain: 0.22,
    envelope: { attackMs: 10, decayMs: 300, sustainLevel: 0.6, releaseMs: 700 },
    filter: { type: 'lowpass', cutoffHz: 1600, resonanceQ: 8 },
    modulation: { lfoFrequencyHz: 5, lfoDepth: 14, detuneCents: -15 },
  },
};

/** Musical helpers used by the engine when playing chained sounds. */
export const SYNTH_SEQUENCES = {
  /** Semitone offsets of the tetris arpeggio relative to tetrisClear.baseFrequencyHz. */
  tetrisArpeggio: [0, 4, 7, 12],
  tetrisArpeggioStepMs: 70,
  /** Semitone step per line in a multi-line clear. */
  lineClearSemitonesPerLine: 3,
  /** Semitone step per combo counter increment (wraps after comboMaxSteps). */
  comboSemitonesPerStep: 2,
  comboMaxSteps: 12,
  /** Extra semitones for b2b tetrises / perfect clears. */
  b2bSemitones: 5,
};

export const SYNTH_GLOBAL = {
  masterGain: 0.55,
  /** Dynamics compressor on the master bus (keeps stacked sounds from clipping). */
  compressor: { thresholdDb: -18, kneeDb: 12, ratio: 4, attackS: 0.003, releaseS: 0.18 },
  /**
   * Effect of setTensionState(t) at t = 1 (linearly interpolated from t = 0).
   * Phase 2 will drive tension from the model's survival prediction.
   */
  tension: {
    pitchShiftCents: 250, // global pitch raise
    cutoffMultiplier: 1.8, // filter cutoff scaling
    extraLfoDepthHz: 10, // added vibrato depth
    extraLfoRateHz: 4, // added vibrato rate
  },
};
