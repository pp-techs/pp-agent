import { describe, expect, it } from "vite-plus/test";

import { parseServerAddress } from "./server-address";

describe("parseServerAddress", () => {
  it("reads the pairing link from the computer's QR code", () => {
    expect(parseServerAddress("http://192.168.1.20:47830/#pair=AB12CD34", 47830)).toEqual({
      server: "http://192.168.1.20:47830",
      code: "AB12CD34",
    });
  });

  it("takes a bare address, adding the scheme and Phone access's port", () => {
    expect(parseServerAddress("  192.168.1.20:47831 ", 47830)).toEqual({
      server: "http://192.168.1.20:47831",
      code: null,
    });
    expect(parseServerAddress("100.101.102.103", 47830)?.server).toBe(
      "http://100.101.102.103:47830",
    );
    expect(parseServerAddress("my-mac.local", 47830)?.server).toBe("http://my-mac.local:47830");
  });

  it("keeps HTTPS addresses as given, such as tailscale serve", () => {
    expect(parseServerAddress("https://my-mac.tail1234.ts.net", 47830)?.server).toBe(
      "https://my-mac.tail1234.ts.net",
    );
  });

  it("drops paths and queries, keeping only the computer's origin", () => {
    expect(parseServerAddress("http://10.0.0.5:47830/chat?x=1", 47830)?.server).toBe(
      "http://10.0.0.5:47830",
    );
  });

  it("refuses what is not an address", () => {
    expect(parseServerAddress("", 47830)).toBeNull();
    expect(parseServerAddress("not an address!!", 47830)).toBeNull();
    expect(parseServerAddress("ftp://10.0.0.5", 47830)).toBeNull();
    expect(parseServerAddress("javascript://alert(1)", 47830)).toBeNull();
    expect(parseServerAddress("WIFI:S:home;T:WPA;P:secret;;", 47830)).toBeNull();
  });
});
