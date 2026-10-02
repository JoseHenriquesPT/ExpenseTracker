import type {
  ExpenseEntry, Person, PersonalExpenseEntry, PlannedExpense, Scope,
} from "../db/types";

/** What the purchase dialog collects: the price actually paid and where the
 *  expense belongs. `paidBy` is the payer for a Common purchase; for an
 *  individual purchase the scope itself is the person. */
export interface PurchaseInput {
  value: number;
  scope: Scope;
  paidBy: Person;
  date: string; // ISO YYYY-MM-DD
}

/** Which ledger a purchased plan lands in, and the row to insert there. */
export type PurchaseTarget =
  | { table: "expenses"; row: ExpenseEntry }
  | { table: "personalExpenses"; row: PersonalExpenseEntry };

const FALLBACK_CATEGORY = "Planned expense";

/** Build the expense row a purchased plan becomes: the plan name is the
 *  category, so the Dashboard's spending breakdown keeps it readable. Common
 *  items carry the payer (they enter the settlement); individual items are
 *  attributed to the scope's person and never settle. */
export function purchaseEntry(
  plan: PlannedExpense,
  input: PurchaseInput
): PurchaseTarget {
  const category = plan.name.trim() || FALLBACK_CATEGORY;
  if (input.scope === "Common") {
    return {
      table: "expenses",
      row: {
        date: input.date,
        value: input.value,
        category,
        paidBy: input.paidBy,
        description: "Planned purchase",
      },
    };
  }
  return {
    table: "personalExpenses",
    row: {
      date: input.date,
      value: input.value,
      category,
      person: input.scope,
      description: "Planned purchase",
    },
  };
}

/** The fields stamped on the plan once its expense row is saved. paidBy is
 *  only meaningful (and only stored) for Common purchases. */
export function purchasedPlanPatch(input: PurchaseInput): {
  purchased: true;
  purchasedDate: string;
  finalValue: number;
  scope: Scope;
  paidBy?: Person;
} {
  return {
    purchased: true,
    purchasedDate: input.date,
    finalValue: input.value,
    scope: input.scope,
    ...(input.scope === "Common" ? { paidBy: input.paidBy } : {}),
  };
}
