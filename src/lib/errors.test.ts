import { describe, expect, it } from "vitest";
import { toMessage } from "./errors";

describe("toMessage", () => {
  it("maps network failures to one friendly sentence", () => {
    const networkFailures = [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "fetch failed",
    ];
    for (const msg of networkFailures) {
      expect(toMessage(new Error(msg))).toMatch(/couldn't reach the server/i);
    }
  });

  it("passes other error messages through unchanged", () => {
    expect(toMessage(new Error("That invite code is not valid."))).toBe(
      "That invite code is not valid.",
    );
    expect(toMessage({ message: "This account already belongs to a household." })).toBe(
      "This account already belongs to a household.",
    );
  });

  it("stringifies non-Error throws", () => {
    expect(toMessage("boom")).toBe("boom");
  });
});
