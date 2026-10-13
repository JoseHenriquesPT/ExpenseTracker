import { describe, expect, it } from "vitest";
import { availableTags, filterByTags, toggleTag } from "./plannedTags";
import type { PlannedExpense } from "../db/types";

const plan = (name: string, tags: string[] = []): PlannedExpense => ({
  id: 1,
  name,
  links: [],
  purchased: false,
  tags,
});

describe("availableTags", () => {
  it("offers configured tags in config order, filtered to those in use", () => {
    const plans = [plan("Sofa", ["Living room"]), plan("Sink", ["Kitchen"])];
    expect(availableTags(plans, ["Kitchen", "Living room", "Garden"])).toEqual([
      "Kitchen",
      "Living room",
    ]);
  });

  it("appends stale assigned tags (no longer configured) sorted, without duplicates", () => {
    const plans = [
      plan("Sofa", ["Bedroom", "Garden", "Garden"]),
      plan("Sink", ["Garden"]),
    ];
    expect(availableTags(plans, ["Garden"])).toEqual(["Garden", "Bedroom"]);
  });

  it("returns nothing when no plan is tagged", () => {
    expect(availableTags([plan("Sofa")], ["Kitchen"])).toEqual([]);
    expect(availableTags([], [])).toEqual([]);
  });
});

describe("filterByTags", () => {
  const plans = [
    plan("Sofa", ["Living room"]),
    plan("Sink", ["Kitchen"]),
    plan("Paint", ["Living room", "Kitchen"]),
    plan("Mystery"),
  ];

  it("returns every plan when nothing is selected", () => {
    expect(filterByTags(plans, [])).toEqual(plans);
  });

  it("keeps plans carrying any of the selected tags (OR)", () => {
    expect(filterByTags(plans, ["Kitchen"]).map((p) => p.name)).toEqual([
      "Sink",
      "Paint",
    ]);
    expect(filterByTags(plans, ["Kitchen", "Living room"]).map((p) => p.name)).toEqual([
      "Sofa",
      "Sink",
      "Paint",
    ]);
  });

  it("drops plans with none of the selected tags", () => {
    expect(filterByTags(plans, ["Garden"])).toEqual([]);
  });
});

describe("toggleTag", () => {
  it("adds a tag that isn't selected", () => {
    expect(toggleTag(["Kitchen"], "Garden")).toEqual(["Kitchen", "Garden"]);
  });

  it("removes a tag that is selected", () => {
    expect(toggleTag(["Kitchen", "Garden"], "Kitchen")).toEqual(["Garden"]);
  });
});
