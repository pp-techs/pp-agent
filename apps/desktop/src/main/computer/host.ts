import { join } from "node:path";
import type { ComputerRequest, ComputerResult, ComputerStatus } from "@workspace/shared";
import { app, desktopCapturer, shell, systemPreferences } from "electron";
import { ComputerAutomation } from "./automation.ts";
import { CuaDriver, findCuaDriver } from "./driver.ts";

const SCREEN_RECORDING_PANE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

const MISSING_PERMISSIONS =
  "PP Agent may not control this computer yet: macOS has not given it Accessibility and Screen Recording access. Ask the user to open Settings › Computer use in PP Agent and grant access, then try again.";

export interface ComputerHostOptions {
  resourcesDir: string;
  userDataDir: string;
  /** PP Agent's bundle id (`appId` of electron-builder). */
  bundleId: string;
  log(line: string): void;
}

/**
 * The window's side of the agent's `computer` tool: whether cua-driver ships with this build,
 * PP Agent's macOS grants, and the driver itself, which runs as a direct child of this process so
 * those grants are the ones macOS checks.
 */
export class ComputerHost {
  private readonly driver: CuaDriver | null;
  private readonly automation: ComputerAutomation | null;

  constructor(options: ComputerHostOptions) {
    const binary = findCuaDriver(options.resourcesDir);
    this.driver = binary
      ? new CuaDriver({
          binary,
          home: join(options.userDataDir, "cua-driver"),
          hostBundleId: options.bundleId,
          appVersion: app.getVersion(),
          log: (line) => options.log(line),
        })
      : null;
    this.automation = this.driver
      ? new ComputerAutomation(
          (name, args, signal) => this.driver!.call(name, args, signal),
          () => [process.pid, ...app.getAppMetrics().map((metric) => metric.pid)],
        )
      : null;
  }

  get supported(): boolean {
    return this.driver !== null;
  }

  status(): ComputerStatus {
    if (process.platform !== "darwin")
      return { supported: this.supported, accessibility: true, screenRecording: true };
    return {
      supported: this.supported,
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: systemPreferences.getMediaAccessStatus("screen") === "granted",
    };
  }

  /**
   * Asks macOS for what is missing: Accessibility shows its prompt (which opens its settings pane);
   * Screen Recording prompts once through a capture request, and afterwards only its pane can
   * change it. A driver started before the change is stopped so the next step sees the new grants.
   */
  async requestPermissions(): Promise<ComputerStatus> {
    const before = this.status();
    if (process.platform === "darwin") {
      if (!before.accessibility) systemPreferences.isTrustedAccessibilityClient(true);
      if (before.accessibility && !before.screenRecording) {
        if (systemPreferences.getMediaAccessStatus("screen") === "not-determined")
          await desktopCapturer
            .getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } })
            .catch(() => undefined);
        if (systemPreferences.getMediaAccessStatus("screen") !== "granted")
          await shell.openExternal(SCREEN_RECORDING_PANE);
      }
      await this.driver?.stop();
    }
    return this.status();
  }

  run(request: ComputerRequest, signal?: AbortSignal): Promise<ComputerResult> {
    if (!this.automation)
      return Promise.reject(new Error("Computer use is not part of this build of PP Agent."));
    const status = this.status();
    if (!status.accessibility || !status.screenRecording)
      return Promise.reject(new Error(MISSING_PERMISSIONS));
    return this.automation.run(request, signal);
  }

  async dispose(): Promise<void> {
    await this.driver?.stop();
  }
}
