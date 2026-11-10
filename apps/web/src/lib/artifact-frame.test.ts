import { expect, it } from "vite-plus/test";

import { artifactFrameUrl, withLocalLibraries } from "./artifact-frame";

const base = "http://192.168.1.9:47830/";

it("loads the frame from the desktop app's scheme, and the bundled page elsewhere", () => {
  expect(artifactFrameUrl("desktop", base)).toBe("pp-artifact://frame/");
  expect(artifactFrameUrl("web", base)).toBe("http://192.168.1.9:47830/artifact-frame.html");
  // The phone app's page is its own scheme.
  expect(artifactFrameUrl("web", "capacitor://localhost/")).toBe(
    "capacitor://localhost/artifact-frame.html",
  );
});

it("points the libraries an HTML page names at the copies bundled beside the app", () => {
  const html = '<script src="pp-artifact://lib/chart.js"></script>';
  expect(withLocalLibraries(html, "web", base)).toBe(
    '<script src="http://192.168.1.9:47830/artifact-libs/chart.js"></script>',
  );
});

it("leaves the page alone in the desktop app, whose scheme answers the library", () => {
  const html = '<script src="pp-artifact://lib/chart.js"></script>';
  expect(withLocalLibraries(html, "desktop", base)).toBe(html);
});

it("keeps the rest of the page as it is", () => {
  const html = "<h1>Sales</h1><p>No scripts here.</p>";
  expect(withLocalLibraries(html, "web", base)).toBe(html);
});
