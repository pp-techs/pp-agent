import type { ResearchSummary } from "@workspace/shared";
import { expect, it } from "vite-plus/test";

import {
  isWebUrl,
  parseResearchCommand,
  parseResearchDepth,
  reportFileName,
  researchPhaseKey,
  sourceHost,
} from "./research";

const run: ResearchSummary = {
  question: "q",
  depth: "standard",
  status: "active",
  phase: "researching",
  waiting: false,
  visited: 0,
  sources: [],
  report: null,
};

it("reads /research with a question, and an optional depth before it", () => {
  expect(parseResearchCommand("/research solar panels in Vietnam")).toEqual({
    depth: null,
    question: "solar panels in Vietnam",
  });
  expect(parseResearchCommand("  /RESEARCH  Deep  compare\nthe two vendors ")).toEqual({
    depth: "deep",
    question: "compare\nthe two vendors",
  });
  expect(parseResearchCommand("/research quick what is MCP")).toEqual({
    depth: "quick",
    question: "what is MCP",
  });
  expect(parseResearchCommand("/research standard")).toEqual({ depth: "standard", question: "" });
});

it("keeps a depth word that is part of the question", () => {
  expect(parseResearchCommand("/research deepseek models")).toEqual({
    depth: null,
    question: "deepseek models",
  });
});

it("leaves a bare /research and other messages alone", () => {
  expect(parseResearchCommand("/research")).toBeNull();
  expect(parseResearchCommand("/research   ")).toBeNull();
  expect(parseResearchCommand("/researcher notes")).toBeNull();
  expect(parseResearchCommand("please /research this")).toBeNull();
});

it("accepts only the known depths from storage", () => {
  expect(parseResearchDepth("deep")).toBe("deep");
  expect(parseResearchDepth("thorough")).toBeNull();
  expect(parseResearchDepth(null)).toBeNull();
});

it("tells where a run stands, paused and done before the phase", () => {
  expect(researchPhaseKey(run)).toBe("research.phase.researching");
  expect(researchPhaseKey({ ...run, waiting: true })).toBe("research.phase.waiting");
  expect(researchPhaseKey({ ...run, phase: "plan", waiting: true })).toBe("research.phase.plan");
  expect(researchPhaseKey({ ...run, phase: "writing" })).toBe("research.phase.writing");
  expect(researchPhaseKey({ ...run, status: "paused", waiting: true })).toBe(
    "research.phase.paused",
  );
  expect(researchPhaseKey({ ...run, status: "done", phase: "done" })).toBe("research.phase.done");
});

it("links only web pages, and shortens an address to its site", () => {
  expect(isWebUrl("https://example.com/a")).toBe(true);
  expect(isWebUrl("http://example.com")).toBe(true);
  expect(isWebUrl("javascript:alert(1)")).toBe(false);
  expect(isWebUrl("file:///etc/passwd")).toBe(false);
  expect(isWebUrl("not a url")).toBe(false);
  expect(sourceHost("https://www.example.com/a/b?c=1")).toBe("example.com");
  expect(sourceHost("not a url")).toBe("not a url");
});

it("names a report file by the last part of its path", () => {
  expect(reportFileName("research/solar-2026-11-08/report.md")).toBe("report.md");
  expect(reportFileName("solar.md")).toBe("solar.md");
});
