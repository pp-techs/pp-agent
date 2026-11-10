import { expect, it } from "vite-plus/test";

import { splitFrontmatter } from "./frontmatter";

it("splits a skill file's frontmatter from its body", () => {
  const file = [
    "---",
    "name: dokploy",
    'description: "Deploy apps to a self-hosted PaaS"',
    "tags:",
    "  - deploy",
    "  - docker",
    "---",
    "",
    "# Dokploy",
    "Body text.",
  ].join("\n");
  expect(splitFrontmatter(file)).toEqual({
    fields: [
      { key: "name", value: "dokploy" },
      { key: "description", value: "Deploy apps to a self-hosted PaaS" },
      { key: "tags", value: "deploy, docker" },
    ],
    body: "# Dokploy\nBody text.",
  });
});

it("leaves a file without frontmatter alone", () => {
  const file = "# Title\n\nSome — text.";
  expect(splitFrontmatter(file)).toEqual({ fields: [], body: file });
});

it("does not read a rule in the middle of a file as frontmatter", () => {
  const file = "Intro\n\n---\n\nAfter.";
  expect(splitFrontmatter(file)).toEqual({ fields: [], body: file });
});

it("leaves an unclosed block alone", () => {
  const file = "---\nname: x\n\n# Body";
  expect(splitFrontmatter(file)).toEqual({ fields: [], body: file });
});

it("leaves a block without keys alone, so its text is not lost", () => {
  const file = "---\njust some words\n---\n\n# Body";
  expect(splitFrontmatter(file)).toEqual({ fields: [], body: file });
});

it("keeps a nested block with its key, and accepts ... as the end", () => {
  const file = ["---", "author:", "  name: An", "date: 2026-11-10", "...", "Body."].join("\n");
  expect(splitFrontmatter(file)).toEqual({
    fields: [
      { key: "author", value: "name: An" },
      { key: "date", value: "2026-11-10" },
    ],
    body: "Body.",
  });
});
