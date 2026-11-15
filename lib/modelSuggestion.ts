// The starting-model suggestion on a new thread (spec phase 7): a first message that looks
// simple, on a model several times the price of its provider's cheapest, gets a one-line offer.

const MAX_CHARS = 300;
const MAX_LINES = 2;
export const PRICE_GAP = 4; // the selected model's input + output price, over the cheapest's

// Short, plain text: a few hundred characters, at most a couple of lines, no code, no images.
export function looksSimple(text: string, imageCount: number) {
  const t = text.trim();
  return (
    t.length > 0 &&
    t.length <= MAX_CHARS &&
    t.split("\n").length <= MAX_LINES &&
    !t.includes("```") &&
    imageCount === 0
  );
}

type Prices = { input: number; output: number } | null;

// Whether the selected model's price is far enough above the cheapest's to be worth a mention.
export function worthSuggesting(selected: Prices, cheapest: Prices) {
  if (!selected || !cheapest) return false;
  const cheap = cheapest.input + cheapest.output;
  return cheap > 0 && selected.input + selected.output >= PRICE_GAP * cheap;
}
