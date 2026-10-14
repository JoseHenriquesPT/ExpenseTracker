import { describe, expect, it } from "vitest";
import { safeUrl } from "./links";

describe("safeUrl", () => {
  it("allows http, https and mailto links", () => {
    expect(safeUrl("https://example.com/couch")).toBe("https://example.com/couch");
    expect(safeUrl("http://example.com")).toBe("http://example.com");
    expect(safeUrl("mailto:partner@example.com")).toBe("mailto:partner@example.com");
    expect(safeUrl("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
  });

  it("rejects script-bearing schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeUrl("  jAvAsCrIpT:alert(1)")).toBeNull();
    expect(safeUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects control-character smuggling", () => {
    expect(safeUrl("java\nscript:alert(1)")).toBeNull();
    expect(safeUrl("java\tscript:alert(1)")).toBeNull();
    expect(safeUrl("java\u0000script:alert(1)")).toBeNull();
  });

  it("rejects schemes outside the allowlist", () => {
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("blob:https://example.com/uuid")).toBeNull();
    expect(safeUrl("about:blank")).toBeNull();
  });

  it("rejects protocol-relative and bare relative URLs", () => {
    expect(safeUrl("//evil.example.com")).toBeNull();
    expect(safeUrl("/dashboard")).toBeNull();
    expect(safeUrl("example.com")).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("   ")).toBeNull();
  });

  it("rejects garbage that is not a URL", () => {
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl("???")).toBeNull();
  });
});
