/**
 * Title-screen taglines. One is picked at random on every page load
 * (never the same one twice in a row). Add or remove lines freely.
 */
export const TAGLINES: readonly string[] = [
  'Spielen für die Wissenschaft',
  'Jeder Stein ein Datenpunkt',
  'Dein Game Over trainiert ein neuronales Netz',
  'No game, no gain',
  'Stapeln im Dienste der Forschung',
  'Das Modell schaut zu. Kein Druck.',
  'Gradientenabstieg, aber mit Steinen',
  'Zeilen löschen, Loss senken',
  'Wie lange überlebst du? Das Netz will es wissen.',
  'Garantiert 100 % handgestapelt',
  'Overfitting beginnt hier',
  'Dein Top Out ist unser Trainingsbeispiel',
  'Jetzt mit 0 % Hold-Funktion',
  'Das I-Stück kommt gleich. Bestimmt.',
  "Drop it like it's slop"
];

const LAST_KEY = 'tetrislop.last_tagline';

/** Random tagline, avoiding the one shown on the previous visit. */
export function pickTagline(random: () => number = Math.random): string {
  let last = -1;
  try { last = Number(localStorage.getItem(LAST_KEY) ?? -1); } catch { /* storage blocked */ }
  let i = Math.floor(random() * TAGLINES.length);
  if (TAGLINES.length > 1 && i === last) i = (i + 1 + Math.floor(random() * (TAGLINES.length - 1))) % TAGLINES.length;
  try { localStorage.setItem(LAST_KEY, String(i)); } catch { /* ignore */ }
  return TAGLINES[i];
}
