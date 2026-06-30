import { db } from "../db/db";

/** Dump every table to a JSON file the user can download. */
export async function exportBackup(): Promise<void> {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    expenses: await db.expenses.toArray(),
    income: await db.income.toArray(),
    personalExpenses: await db.personalExpenses.toArray(),
    investments: await db.investments.toArray(),
    bills: await db.bills.toArray(),
    billPayments: await db.billPayments.toArray(),
    settlements: await db.settlements.toArray(),
    config: await db.config.toArray(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expense-tracker-backup-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Replace all data with the contents of a previously exported backup.
 *  Note: not transactional against the hosted DB — it clears then re-adds. */
export async function importBackup(file: File): Promise<void> {
  const text = await file.text();
  const data = JSON.parse(text);
  await Promise.all([
    db.expenses.clear(),
    db.income.clear(),
    db.personalExpenses.clear(),
    db.investments.clear(),
    db.bills.clear(),
    db.billPayments.clear(),
    db.settlements.clear(),
    db.config.clear(),
  ]);
  if (data.expenses?.length) await db.expenses.bulkAdd(data.expenses);
  if (data.income?.length) await db.income.bulkAdd(data.income);
  if (data.personalExpenses?.length) await db.personalExpenses.bulkAdd(data.personalExpenses);
  if (data.investments?.length) await db.investments.bulkAdd(data.investments);
  if (data.bills?.length) await db.bills.bulkAdd(data.bills);
  if (data.billPayments?.length) await db.billPayments.bulkAdd(data.billPayments);
  if (data.settlements?.length) await db.settlements.bulkAdd(data.settlements);
  if (data.config?.length) await db.config.bulkAdd(data.config);
}
