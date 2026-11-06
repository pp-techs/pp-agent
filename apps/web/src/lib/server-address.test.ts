import { describe, expect, it } from "vite-plus/test";

import { allowsPlainHttp, parseServerAddress } from "./server-address";

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

  it("keeps a port given on purpose, even HTTP's default", () => {
    expect(parseServerAddress("http://10.0.0.5:80", 47830)?.server).toBe("http://10.0.0.5");
    expect(parseServerAddress("10.0.0.5:80/#pair=AB12CD34", 47830)).toEqual({
      server: "http://10.0.0.5",
      code: "AB12CD34",
    });
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

describe("allowsPlainHttp", () => {
  it("allows HTTP on the person's own network and over Tailscale", () => {
    for (const server of [
      "http://192.168.1.20:47830",
      "http://10.4.63.227:47830",
      "http://172.20.0.5:47830",
      "http://100.96.85.90:47830",
      "http://127.0.0.1:47830",
      "http://169.254.10.2:47830",
      "http://[fd7a:115c:a1e0::1]:47830",
      "http://my-mac:47830",
      "http://my-mac.local:47830",
      "http://nas.lan:47830",
      "http://mbp.tail3e8499.ts.net:47830",
    ]) {
      expect(allowsPlainHttp(server), server).toBe(true);
    }
  });

  it("requires HTTPS anywhere else", () => {
    for (const server of [
      "http://8.8.8.8:47830",
      "http://100.200.1.1:47830",
      "http://172.32.0.1:47830",
      "http://agent.example.com:47830",
      "http://[2001:db8::1]:47830",
    ]) {
      expect(allowsPlainHttp(server), server).toBe(false);
    }
    expect(allowsPlainHttp("https://agent.example.com")).toBe(true);
  });
});
