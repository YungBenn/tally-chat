// A rolling number (design system: CostStrip): each digit is a 0-9 column moved to its value, so a
// changing estimate rolls in place. Other characters ("$", ".", "k") stay fixed. Columns are keyed
// from the right, so "9.99" -> "10.01" keeps the decimals in their columns and only grows leftward.
export type RollCell = { key: string; digit: number } | { key: string; char: string };

export function rollCells(value: string): RollCell[] {
  const chars = [...value];
  return chars.map((ch, i) => {
    const key = String(chars.length - i);
    const d = ch.charCodeAt(0) - 48;
    return d >= 0 && d <= 9 ? { key, digit: d } : { key, char: ch };
  });
}
