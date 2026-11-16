// Models mostly write LaTeX as \( … \) and \[ … \]; remark-math reads only dollars. Single
// dollars stay plain text (remark-math's singleDollarTextMath is off), because this app talks
// in prices: "$5 and $10" must not become math. So \( … \) becomes inline $$ … $$, and
// \[ … \] a $$ display block. Fenced and inline code pass through untouched.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;

export function normalizeMath(text: string): string {
  return text
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `\n$$\n${m.trim()}\n$$\n`)
            .replace(/\\\((.+?)\\\)/g, (_, m: string) => `$$${m}$$`),
    )
    .join("");
}
