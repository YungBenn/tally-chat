// A user message's stored date line, e.g. "Thursday, 26 November 2026", and how it renders into
// the request. Decided once at send time and stored, so request bytes never depend on settings
// or on when the request is built.
export function dateLine(at: number, timeZone = "UTC") {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

export const dateBlock = (date: string) => `<current_date>${date}</current_date>`;
// What the tag adds to a draft before it is sent, counted whether or not the send will carry one.
// ponytail: a fixed guess (the longest date line is about 15 tokens); measured usage replaces it.
export const DATE_TAG_TOKENS_ESTIMATE = 15;
