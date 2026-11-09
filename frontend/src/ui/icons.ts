import type { InputDevice } from '../core/types';

/** Input-method icons (same artwork as the title screen's input button). */
export const DEVICE_ICONS: Record<Exclude<InputDevice, 'mixed'>, string> = {
  keyboard:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 9.5h1M9 9.5h1M12 9.5h1M15 9.5h1M18 9.5h0.01M6 12h1M9 12h1M12 12h1M15 12h1M18 12h0.01M8 15h8" /></svg>',
  touch:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.2" /><path d="M10.5 18.5h3" /></svg>',
  gamepad:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10a5 5 0 0 1 4.9 6l-.8 3.6a2.2 2.2 0 0 1-3.8 1L15.5 15.5h-7l-1.8 2.1a2.2 2.2 0 0 1-3.8-1L2.1 13A5 5 0 0 1 7 7z" /><path d="M7.5 10v3M6 11.5h3" /><path d="M16 10.5h0.01M18 12.5h0.01" /></svg>',
};

export const DEVICE_NAMES: Record<Exclude<InputDevice, 'mixed'>, string> = {
  keyboard: 'Tastatur',
  touch: 'Touch',
  gamepad: 'Controller',
};
