import { describe, expect, test, vi } from "vite-plus/test";
import type { AppSettings, Question } from "@workspace/shared";
import {
  ASK_LIMITS,
  ASK_TOOL,
  askSection,
  checkAnswers,
  checkQuestions,
  createAskTool,
  formatAnswers,
  normalizeQuestions,
  type AskUser,
} from "./ask.ts";
import { AGENT_TOOLS, agentAllowsTool, helperTools, toolRule, toolTier } from "./tools.ts";

const scope: Question = {
  id: "scope",
  question: "Which period?",
  options: [{ label: "Q3", description: "July to September" }, { label: "Q4" }],
  recommended: 1,
};
const formats: Question = {
  id: "formats",
  question: "Which formats?",
  multi: true,
  options: [{ label: "PDF" }, { label: "Excel" }],
};

describe("checkQuestions", () => {
  test("accepts well-formed questions", () => {
    expect(checkQuestions([scope, formats])).toBeNull();
  });

  test("refuses what the model can fix", () => {
    expect(checkQuestions([])).toMatch(/at least one/);
    expect(
      checkQuestions(Array.from({ length: ASK_LIMITS.maxQuestions + 1 }, () => scope)),
    ).toMatch(/at most/);
    expect(checkQuestions([scope, scope])).toMatch(/used twice/);
    expect(checkQuestions([{ ...scope, options: [{ label: "Only" }] }])).toMatch(/at least 2/);
    expect(
      checkQuestions([
        { ...scope, options: Array.from({ length: 7 }, (_, i) => ({ label: `o${i}` })) },
      ]),
    ).toMatch(/more than/);
    expect(checkQuestions([{ ...scope, options: [{ label: "A" }, { label: "a" }] }])).toMatch(
      /twice/,
    );
    expect(checkQuestions([{ ...scope, options: [{ label: "A" }, { label: "Other" }] }])).toMatch(
      /"Other"/,
    );
    expect(
      checkQuestions([{ ...scope, options: [{ label: "A" }, { label: "other (type your own)" }] }]),
    ).toMatch(/"Other"/);
    expect(checkQuestions([{ ...scope, id: "" }])).toMatch(/id/);
  });
});

describe("normalizeQuestions", () => {
  test("trims text and drops a recommendation that points nowhere", () => {
    const [question] = normalizeQuestions([
      {
        id: " scope ",
        question: " Which? ",
        options: [
          { label: " A ", description: "  " },
          { label: "B", description: " b " },
        ],
        recommended: 5,
      },
    ]);
    expect(question).toEqual({
      id: "scope",
      question: "Which?",
      options: [{ label: "A" }, { label: "B", description: "b" }],
    });
  });

  test("keeps multi and a valid recommendation", () => {
    const [question] = normalizeQuestions([{ ...formats, recommended: 0 }]);
    expect(question).toMatchObject({ multi: true, recommended: 0 });
  });
});

describe("checkAnswers", () => {
  test("puts the answers in question order and trims the custom text", () => {
    expect(
      checkAnswers(
        [scope, formats],
        [
          { id: "formats", selected: ["PDF", "PDF", "Excel"], custom: "  CSV " },
          { id: "scope", selected: ["Q3"] },
        ],
      ),
    ).toEqual([
      { id: "scope", selected: ["Q3"] },
      { id: "formats", selected: ["PDF", "Excel"], custom: "CSV" },
    ]);
  });

  test("accepts a typed answer instead of an option", () => {
    expect(checkAnswers([scope], [{ id: "scope", selected: [], custom: "Q1" }])).toEqual([
      { id: "scope", selected: [], custom: "Q1" },
    ]);
  });

  test("refuses answers that do not fit", () => {
    expect(() => checkAnswers([scope], [])).toThrow(/Answer the question/);
    expect(() => checkAnswers([scope], [{ id: "scope", selected: [] }])).toThrow(/Answer/);
    expect(() => checkAnswers([scope], [{ id: "scope", selected: [], custom: "  " }])).toThrow(
      /Answer/,
    );
    expect(() => checkAnswers([scope], [{ id: "scope", selected: ["Q9"] }])).toThrow(
      /not one of the options/,
    );
    expect(() => checkAnswers([scope], [{ id: "scope", selected: ["Q3", "Q4"] }])).toThrow(
      /Pick one/,
    );
    expect(() =>
      checkAnswers([scope], [{ id: "scope", selected: ["Q3"], custom: "and more" }]),
    ).toThrow(/Pick one/);
    expect(() =>
      checkAnswers(
        [scope],
        [{ id: "scope", selected: [], custom: "x".repeat(ASK_LIMITS.maxCustomLength + 1) }],
      ),
    ).toThrow(/too long/);
  });
});

describe("formatAnswers", () => {
  test("one question reads as a sentence", () => {
    expect(formatAnswers([scope], [{ id: "scope", selected: ["Q3"] }])).toBe("User answered: Q3");
    expect(formatAnswers([scope], [{ id: "scope", selected: [], custom: "Q1" }])).toBe(
      "User answered: Other: Q1",
    );
  });

  test("several questions list one line per id", () => {
    expect(
      formatAnswers(
        [scope, formats],
        [
          { id: "scope", selected: ["Q4"] },
          { id: "formats", selected: ["PDF", "Excel"], custom: "CSV" },
        ],
      ),
    ).toBe("User answers:\n- scope: Q4\n- formats: PDF, Excel, Other: CSV");
  });

  test("a missing answer is said so", () => {
    expect(formatAnswers([scope, formats], [{ id: "scope", selected: ["Q3"] }])).toContain(
      "- formats: (no answer)",
    );
  });
});

describe("ask_user tool", () => {
  async function run(askUser: AskUser, questions: Question[], signal?: AbortSignal) {
    const tool = createAskTool(askUser);
    return tool.execute("call1", { questions }, signal, undefined, undefined as never);
  }

  test("asks with the trimmed questions and returns the answers as text", async () => {
    const askUser = vi.fn<AskUser>(async () => [{ id: "scope", selected: ["Q3"] }]);
    const result = await run(askUser, [{ ...scope, question: " Which period? " }]);
    expect(askUser).toHaveBeenCalledTimes(1);
    expect(askUser.mock.calls[0]?.[0]).toEqual({
      toolCallId: "call1",
      questions: [{ ...scope, question: "Which period?" }],
    });
    expect(result.content).toEqual([{ type: "text", text: "User answered: Q3" }]);
  });

  test("passes the abort signal on", async () => {
    const controller = new AbortController();
    const askUser = vi.fn<AskUser>(async () => [{ id: "scope", selected: ["Q3"] }]);
    await run(askUser, [scope], controller.signal);
    expect(askUser.mock.calls[0]?.[1]).toBe(controller.signal);
  });

  test("a skipped question is an error the model can read", async () => {
    await expect(run(async () => null, [scope])).rejects.toThrow("The user chose not to answer.");
  });

  test("bad questions never reach the person", async () => {
    const askUser = vi.fn<AskUser>(async () => null);
    await expect(run(askUser, [scope, scope])).rejects.toThrow(/used twice/);
    expect(askUser).not.toHaveBeenCalled();
  });

  test("runs one at a time", () => {
    expect(createAskTool(async () => null).executionMode).toBe("sequential");
  });
});

describe("ask_user in the tool rules", () => {
  const settings = { toolPolicies: {}, shellEnabled: false } as unknown as AppSettings;

  test("it is a read tool that runs without asking", () => {
    expect(toolTier(ASK_TOOL)).toBe("read");
    expect(toolRule(ASK_TOOL, "read", settings).effective).toBe("allow");
  });

  test("an agent can be limited to it or without it, and Settings can turn it off", () => {
    expect(AGENT_TOOLS).toContain(ASK_TOOL);
    expect(agentAllowsTool(null, ASK_TOOL)).toBe(true);
    expect(agentAllowsTool(["read"], ASK_TOOL)).toBe(false);
    expect(agentAllowsTool([ASK_TOOL], ASK_TOOL)).toBe(true);
    const off = { ...settings, toolPolicies: { [ASK_TOOL]: "off" } } as unknown as AppSettings;
    expect(toolRule(ASK_TOOL, "read", off).effective).toBe("off");
  });

  test("the delegate_task helper never gets it", () => {
    expect(helperTools(settings, null)).not.toContain(ASK_TOOL);
  });
});

describe("askSection", () => {
  test("guides the model only while the tool is active", () => {
    expect(askSection(["read"])).toBeNull();
    expect(askSection(["read", ASK_TOOL])).toContain("ask_user");
  });
});
