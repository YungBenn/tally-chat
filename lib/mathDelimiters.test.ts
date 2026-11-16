import { describe, expect, test } from "vitest";
import { normalizeMath } from "./mathDelimiters";

describe("normalizeMath", () => {
  test("turns \\( \\) into inline $$ and \\[ \\] into a display block", () => {
    expect(normalizeMath("Euler: \\(e^{i\\pi} + 1 = 0\\).")).toBe("Euler: $$e^{i\\pi} + 1 = 0$$.");
    expect(normalizeMath("Sum:\n\\[\n\\sum_{k=1}^n k = \\frac{n(n+1)}{2}\n\\]\nDone.")).toBe(
      "Sum:\n\n$$\n\\sum_{k=1}^n k = \\frac{n(n+1)}{2}\n$$\n\nDone.",
    );
    expect(normalizeMath("\\[x^2\\]")).toBe("\n$$\nx^2\n$$\n");
  });

  test("leaves code, and text that only looks like math, alone", () => {
    const fenced = "```latex\n\\(x\\) and \\[y\\]\n```";
    expect(normalizeMath(fenced)).toBe(fenced);
    expect(normalizeMath("Use `\\(x\\)` inline.")).toBe("Use `\\(x\\)` inline.");
    expect(normalizeMath("It costs $5 and $10.")).toBe("It costs $5 and $10.");
    expect(normalizeMath("$$a^2$$ stays")).toBe("$$a^2$$ stays");
    expect(normalizeMath("an unclosed \\( stays")).toBe("an unclosed \\( stays");
  });
});
