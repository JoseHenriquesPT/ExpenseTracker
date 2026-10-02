import type { Person, Scope } from "../db/types";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const monthName = (month: number): string => MONTHS[month - 1] ?? "";

export interface PersonNames {
  p1: string;
  p2: string;
}

/** Display name for P1/P2 from the configured names. */
export function personName(person: Person, names: PersonNames): string {
  return person === "P1" ? names.p1 : names.p2;
}

/** Display name for a bill/investment scope. */
export function scopeName(scope: Scope, names: PersonNames): string {
  return scope === "Common" ? "Common" : personName(scope, names);
}

/** The year dropdown window: four before this year, four after. */
export function yearOptions(count = 8): number[] {
  const base = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => base - 4 + i);
}
