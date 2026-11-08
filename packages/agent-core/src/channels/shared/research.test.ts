import { describe, expect, test } from "vite-plus/test";
import { parseResearchArgument } from "./research.ts";

describe("parseResearchArgument", () => {
  test("a question alone runs at standard depth", () => {
    expect(parseResearchArgument("  how do heat pumps work?  ")).toEqual({
      depth: "standard",
      question: "how do heat pumps work?",
    });
  });

  test("a leading depth word picks the depth, in any case", () => {
    expect(parseResearchArgument("deep compare 3 vendors")).toEqual({
      depth: "deep",
      question: "compare 3 vendors",
    });
    expect(parseResearchArgument("QUICK\nwhat is a CRDT")).toEqual({
      depth: "quick",
      question: "what is a CRDT",
    });
  });

  test("a depth word inside the question or glued to a word is part of the question", () => {
    expect(parseResearchArgument("is a deep dive worth it")).toEqual({
      depth: "standard",
      question: "is a deep dive worth it",
    });
    expect(parseResearchArgument("quickly summarise this")).toEqual({
      depth: "standard",
      question: "quickly summarise this",
    });
  });

  test("a depth word alone, or nothing, leaves the question empty", () => {
    expect(parseResearchArgument("deep")).toEqual({ depth: "deep", question: "" });
    expect(parseResearchArgument("")).toEqual({ depth: "standard", question: "" });
  });
});
