import { expect, it } from "vite-plus/test";

import { goalStatusKey, parseGoalCommand } from "./goal";

it("reads /goal with an objective, or one of the words that manage the goal", () => {
  expect(parseGoalCommand("/goal build the report")).toEqual({
    action: "start",
    objective: "build the report",
  });
  expect(parseGoalCommand("  /GOAL   clear the inbox\nthen archive it ")).toEqual({
    action: "start",
    objective: "clear the inbox\nthen archive it",
  });
  expect(parseGoalCommand("/goal Pause")).toEqual({ action: "pause" });
  expect(parseGoalCommand("/goal resume")).toEqual({ action: "resume" });
  expect(parseGoalCommand("/goal clear")).toEqual({ action: "clear" });
});

it("leaves a bare /goal and other messages alone", () => {
  expect(parseGoalCommand("/goal")).toBeNull();
  expect(parseGoalCommand("/goal   ")).toBeNull();
  expect(parseGoalCommand("/goals to reach")).toBeNull();
  expect(parseGoalCommand("my /goal is to win")).toBeNull();
});

it("tells paused, waiting and working goals apart", () => {
  const goal = { objective: "x", status: "active", waiting: false } as const;
  expect(goalStatusKey(goal)).toBe("goal.status.active");
  expect(goalStatusKey({ ...goal, waiting: true })).toBe("goal.status.waiting");
  expect(goalStatusKey({ ...goal, status: "paused", waiting: true })).toBe("goal.status.paused");
});
