import { expect, test } from "vitest";
import { groupThreads } from "./threadGroups";

test("groups threads by local day, keeping order", () => {
  const now = new Date(2026, 10, 15, 9).getTime();
  const at = (d: number, h = 12) => ({
    _creationTime: new Date(2026, 10, 15 - d, h).getTime(),
  });
  const groups = groupThreads(
    [at(0, 8), at(0, 1), at(1), at(3), at(20), at(90)],
    now,
  );
  expect(groups.map((g) => [g.label, g.threads.length])).toEqual([
    ["Today", 2],
    ["Yesterday", 1],
    ["Previous 7 days", 1],
    ["Previous 30 days", 1],
    ["Older", 1],
  ]);
});
