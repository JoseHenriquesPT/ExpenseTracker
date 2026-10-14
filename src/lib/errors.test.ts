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

  it("maps known server messages to their translation", () => {
    expect(toMessage(new Error("That invite code is not valid."))).toBe(
      "That invite code is not valid.",
    );
    expect(toMessage({ message: "This account already belongs to a household." })).toBe(
      "This account already belongs to a household.",
    );
    expect(toMessage(new Error("Only the household owner can dismantle it."))).toBe(
      "Only the household owner can dismantle it.",
    );
  });

  it("hides unknown messages behind one generic sentence", () => {
    expect(toMessage(new Error("boom"))).toMatch(/something went wrong/i);
    expect(
      toMessage(new Error('duplicate key value violates unique constraint "config_household_key"')),
    ).toMatch(/something went wrong/i);
    expect(toMessage(new Error("invalid input syntax for type bigint: xyz"))).toMatch(
      /something went wrong/i,
    );
  });

  it("stringifies non-Error throws behind the same generic sentence", () => {
    expect(toMessage("boom")).toMatch(/something went wrong/i);
    expect(toMessage(undefined)).toMatch(/something went wrong/i);
  });

  it("keeps backup validation errors readable", () => {
    const err = new Error('Backup expenses[0]: "value" must be between 0 and 999999999');
    err.name = "BackupValidationError";
    expect(toMessage(err)).toMatch(/Backup expenses\[0\]/);
  });
});
