import { expect } from "vitest";

// Strips the leading <current_date> tag a sent message carries. The tag has its own tests
// (convex/dateTag.test.ts); elsewhere it is stripped so the clock doesn't matter.
export const untagged = (text: string) => text.replace(/^<current_date>.*<\/current_date>\n\n/, "");

// Matches `text` carrying the date tag a first or new-day message gets, whatever the date.
export const tagged = (text: string) =>
  expect.stringMatching(new RegExp(`^<current_date>[^<]+</current_date>\\n\\n${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
