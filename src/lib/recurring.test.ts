import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  generationThrough,
  occurrenceOnOrBefore,
  occurrencesBetween,
  recurringHorizon,
} from "./recurring";

describe("addMonths", () => {
  it("keeps the day of month when the target month is long enough", () => {
    expect(addMonths("2026-03-15", 2)).toBe("2026-05-15");
    expect(addMonths("2026-03-15", -2)).toBe("2026-01-15");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-30", 1)).toBe("2026-02-28");
  });

  it("handles leap years", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
  });

  it("crosses year boundaries", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("addDays", () => {
  it("steps across month and year boundaries", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("occurrencesBetween", () => {
  it("includes the start date when nothing has been generated yet", () => {
    expect(occurrencesBetween("2026-01-05", undefined, "2026-04-30")).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-05",
      "2026-04-05",
    ]);
  });

  it("only returns months after the last generated occurrence", () => {
    expect(occurrencesBetween("2026-01-31", "2026-02-28", "2026-05-31")).toEqual([
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("does not include an occurrence in the month of `after`", () => {
    expect(occurrencesBetween("2026-01-15", "2026-03-15", "2026-03-31")).toEqual([]);
  });

  it("returns nothing when the series starts after the cutoff", () => {
    expect(occurrencesBetween("2026-06-01", undefined, "2026-05-31")).toEqual([]);
  });

  it("keeps the anchor day when generating several months at once", () => {
    expect(occurrencesBetween("2026-01-31", undefined, "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });
});

describe("occurrenceOnOrBefore", () => {
  it("finds the latest occurrence at or before a date", () => {
    expect(occurrenceOnOrBefore("2026-01-31", "2026-03-01")).toBe("2026-02-28");
    expect(occurrenceOnOrBefore("2026-01-31", "2026-03-31")).toBe("2026-03-31");
    expect(occurrenceOnOrBefore("2026-01-31", "2026-01-31")).toBe("2026-01-31");
  });

  it("returns null when the series has not started yet", () => {
    expect(occurrenceOnOrBefore("2026-06-01", "2026-05-31")).toBeNull();
  });
});

describe("recurringHorizon", () => {
  it("ends on the last day of the month N months ahead", () => {
    expect(recurringHorizon("2026-10-21", 24)).toBe("2028-10-31");
    expect(recurringHorizon("2026-01-31", 1)).toBe("2026-02-28");
    expect(recurringHorizon("2024-12-31", 2)).toBe("2025-02-28");
  });
});

describe("generationThrough", () => {
  it("uses the rolling horizon for series already running", () => {
    expect(generationThrough("2026-01-15", "2026-10-21", 24)).toBe("2028-10-31");
  });

  it("never cuts off a series that starts after the horizon", () => {
    expect(generationThrough("2030-01-15", "2026-10-21", 24)).toBe("2030-01-15");
  });
});
