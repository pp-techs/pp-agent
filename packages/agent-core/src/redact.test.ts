import { describe, expect, test } from "vite-plus/test";
import { redactSecrets, stripInvisible } from "./redact.ts";

describe("stripInvisible", () => {
  test("removes zero-width and bidi override characters while keeping normal Vietnamese text", () => {
    const poisoned = "Hello\u200b \u202eignore\u2066 Tiếng Việt\ufeff";
    expect(stripInvisible(poisoned)).toBe("Hello ignore Tiếng Việt");
  });
});

describe("redactSecrets", () => {
  test("masks known API key prefixes and bare repetitions in prose", () => {
    const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456";
    const text = `Using key ${key}. Remember that ${key} is for prod.`;
    const out = redactSecrets(text);
    expect(out).not.toContain(key);
    expect(out).toBe("Using key [REDACTED]. Remember that [REDACTED] is for prod.");
  });

  test("masks PEM private keys, Bearer tokens, URL credentials, and JSON secret fields", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234567890abcdef\n-----END RSA PRIVATE KEY-----";
    const bearer = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload123456";
    const url = "https://admin:supersecretpass99@db.internal/api?token=tok_secret_value_123456";
    const json = '{"api_key": "my_custom_opaque_secret_987654", "name": "demo"}';
    const text = `${pem}\nAuthorization: Bearer ${bearer}\n${url}\n${json}\nRepeated: my_custom_opaque_secret_987654`;

    const out = redactSecrets(text);
    expect(out).not.toContain("MIIEpAIBAAKCAQEA");
    expect(out).not.toContain(bearer);
    expect(out).not.toContain("supersecretpass99");
    expect(out).not.toContain("tok_secret_value_123456");
    expect(out).not.toContain("my_custom_opaque_secret_987654");
    expect(out).toContain('"name": "demo"');
  });

  test("leaves ordinary text untouched", () => {
    const plain = "Doanh thu Q4 đạt 12.5 tỷ VND, tăng 18% so với cùng kỳ.";
    expect(redactSecrets(plain)).toBe(plain);
  });
});
