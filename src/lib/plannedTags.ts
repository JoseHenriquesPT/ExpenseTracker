import type { PlannedExpense } from "../db/types";

/** Tag filter helpers for the Planned Expenses page. Tags mirror
 *  Config.plannedTags (the managed "areas" list); plans store a copy of the
 *  names, so a tag removed in Settings can linger on old plans. */

/** The tag chips to offer in the filter bar: configured tags that are in use
 *  (kept in config order), then tags still assigned but no longer configured
 *  (sorted), so stale tags stay filterable until removed from the plans. */
export function availableTags(
  plans: PlannedExpense[],
  configured: string[]
): string[] {
  const used = new Set(plans.flatMap((p) => p.tags ?? []));
  const stale = [...used]
    .filter((t) => !configured.includes(t))
    .sort((a, b) => a.localeCompare(b));
  return [...configured.filter((t) => used.has(t)), ...stale];
}

/** Plans carrying at least one selected tag (OR). No selection means no filter. */
export function filterByTags(
  plans: PlannedExpense[],
  selected: string[]
): PlannedExpense[] {
  if (!selected.length) return plans;
  const wanted = new Set(selected);
  return plans.filter((p) => (p.tags ?? []).some((t) => wanted.has(t)));
}

/** Add the tag if absent, remove it if present. */
export function toggleTag(selected: string[], tag: string): string[] {
  return selected.includes(tag)
    ? selected.filter((t) => t !== tag)
    : [...selected, tag];
}
