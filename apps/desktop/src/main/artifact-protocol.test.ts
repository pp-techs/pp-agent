import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARTIFACT_FRAME_URL, ARTIFACT_LIBS } from "@workspace/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ protocol: {} }));

const { ARTIFACT_CSP, artifactResponse } = await import("./artifact-protocol.ts");

describe("artifactResponse", () => {
  let libs: string;
  const libPath = (name: string) => join(libs, name);
  beforeEach(() => {
    libs = mkdtempSync(join(tmpdir(), "pp-artifact-libs-"));
    writeFileSync(join(libs, "chart.js"), "window.Chart = {};");
    // A file next to the libraries that no address may reach.
    writeFileSync(join(libs, "secret.txt"), "secret");
  });
  afterEach(() => rmSync(libs, { recursive: true, force: true }));

  it("serves the frame page under the policy that blocks the network", async () => {
    const response = await artifactResponse(ARTIFACT_FRAME_URL, libPath);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toBe(ARTIFACT_CSP);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it("serves an allowlisted library as a script", async () => {
    const response = await artifactResponse(ARTIFACT_LIBS.chartjs, libPath);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/javascript/);
    expect(await response.text()).toBe("window.Chart = {};");
  });

  it.each([
    "pp-artifact://lib/secret.txt",
    "pp-artifact://lib/../lib/secret.txt",
    "pp-artifact://lib/%2e%2e/secret.txt",
    "pp-artifact://lib/chart.js?x=1",
    "pp-artifact://other/chart.js",
    "pp-artifact://frame/page.html",
  ])("answers 404 for %s", async (url) => {
    const response = await artifactResponse(url, libPath);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("secret");
  });

  it("answers 404 when an allowlisted library is missing", async () => {
    rmSync(join(libs, "chart.js"));
    expect((await artifactResponse(ARTIFACT_LIBS.chartjs, libPath)).status).toBe(404);
  });
});
