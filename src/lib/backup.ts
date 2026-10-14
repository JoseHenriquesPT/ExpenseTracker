import { db } from "../db/db";
import { supabase } from "../db/supabase";
import { touch } from "../db/live";
import i18n from "../i18n";
import {
  BackupValidationError, validateBackup, type BackupData,
} from "./backupSchema";

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

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
    plannedExpenses: await db.plannedExpenses.toArray(),
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

/** Read and validate a backup file. Nothing is written here. */
export async function parseBackupFile(file: File): Promise<BackupData> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new BackupValidationError(i18n.t("errors.backupTooLarge"));
  }
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupValidationError(i18n.t("errors.backupNotJson"));
  }
  return validateBackup(parsed);
}

/**
 * Replace all data with a validated backup. Runs inside the `import_backup`
 * Postgres function (migration 0005) so it either fully succeeds or leaves the
 * current data untouched — there is no half-imported state.
 */
export async function importBackup(data: BackupData): Promise<void> {
  const { error } = await supabase.rpc("import_backup", { payload: data });
  if (!error) {
    touch();
    return;
  }
  if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
    throw new Error(i18n.t("errors.backupMissingMigration"));
  }
  throw new Error(error.message);
}
