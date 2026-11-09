/** Focus navigation over the visible buttons of a container (controller menus). */

function visibleButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => !b.disabled && b.getClientRects().length > 0,
  );
}

/** Moves focus to the next (+1) / previous (-1) button, wrapping around. */
export function moveFocus(root: HTMLElement, step: 1 | -1): void {
  const list = visibleButtons(root);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  const next = i < 0 ? 0 : (i + step + list.length) % list.length;
  focusHighlighted(list[next]);
}

/** Focuses a button and marks it as the controller selection (see trackFocusClass). */
export function focusHighlighted(btn: HTMLElement): void {
  document.querySelectorAll('.gp-focus').forEach((el) => el.classList.remove('gp-focus'));
  btn.classList.add('gp-focus');
  btn.focus({ preventScroll: true });
}

/** The focused button inside root, if any. */
export function focusedButton(root: HTMLElement): HTMLButtonElement | null {
  const a = document.activeElement;
  return a instanceof HTMLButtonElement && root.contains(a) ? a : null;
}

/**
 * Mirrors native focus changes (e.g. a closed dialog returning focus) as the
 * `gp-focus` class. The class is styled while body.gp-nav is set; unlike :focus
 * it stays visible when the browser window is in the background.
 */
export function trackFocusClass(): void {
  document.addEventListener('focusin', (e) => {
    if (!(e.target instanceof HTMLButtonElement)) return;
    document.querySelectorAll('.gp-focus').forEach((el) => el.classList.remove('gp-focus'));
    e.target.classList.add('gp-focus');
  });
}
