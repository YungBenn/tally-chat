// Token cost model for a chat thread with no caching.
// Later lessons extend this with cache reads/writes.
//
// Every turn resends: system prompt + all earlier user and assistant messages + the new user message.
// Prices are USD per million tokens (MTok).

function simulateThread({ system, user, answer, turns, priceIn, priceOut }) {
  const perTurn = [];
  for (let k = 1; k <= turns; k++) {
    const input = system + (k - 1) * (user + answer) + user;
    perTurn.push({ turn: k, input, output: answer });
  }
  const totalIn = perTurn.reduce((s, t) => s + t.input, 0);
  const totalOut = turns * answer;
  const cost = (totalIn * priceIn + totalOut * priceOut) / 1e6;
  return {
    perTurn,
    totalIn,
    totalOut,
    cost,
    typedShare: (turns * user) / totalIn,
    vsSingleTurn: totalIn / perTurn[0].input,
  };
}

// Sonnet 5.5 list prices, checked 2026-10-11 at platform.claude.com/docs/en/about-claude/pricing
const PRICES = { sonnet55: { in: 2, out: 10 } };
