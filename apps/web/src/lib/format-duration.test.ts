import { expect, test } from "vite-plus/test";

import { formatDuration } from "./format-duration";

test("formats a duration", () => {
  expect(formatDuration(45_000)).toBe("45s");
  expect(formatDuration(107_000)).toBe("1m 47s");
  expect(formatDuration(3_900_000)).toBe("1h 5m");
});
