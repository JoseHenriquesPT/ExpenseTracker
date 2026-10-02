import { useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Legend, CartesianGrid,
} from "recharts";
import { useLiveQuery } from "../db/live";
import { db } from "../db/db";
import type { Scope, Person, SettlementRecord } from "../db/types";
import {
  buildIncomeSplits, buildOverview, commonShareFor, computeSettlement,
  monthStart, monthEnd, yearStart, yearEnd, toISO,
  type CategoryTotal, type IncomeSplit, type Settlement,
} from "../lib/finance";
import { fmtMoney } from "../lib/format";
import { MONTHS, monthName, personName, yearOptions } from "../lib/labels";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";
import { useBusy } from "../lib/useBusy";

const PIE_COLORS = [
  "#6c8cff", "#43c59e", "#ffb454", "#ff6b6b", "#b888ff",
  "#4fd1c5", "#f6c177", "#eb6f92", "#9ccfd8", "#c4a7e7",
];

type Mode = "monthly" | "annual";
type Who = "Both" | Person;

export default function Dashboard() {
  const now = new Date();
  const [mode, setMode] = useState<Mode>("monthly");
  const [who, setWho] = useState<Who>("Both");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const online = useOnline();
  const config = useLiveQuery(() => db.config.get({ key: "config" }), []);
  const income = useLiveQuery(() => db.income.toArray(), []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), []);
  const personal = useLiveQuery(() => db.personalExpenses.toArray(), []);
  const bills = useLiveQuery(() => db.bills.toArray(), []);
  const settlements = useLiveQuery(() => db.settlements.toArray(), []);

  const ready = config && income && expenses && personal && bills && settlements;

  const [start, end] = useMemo(
    () =>
      mode === "monthly"
        ? [monthStart(year, month), monthEnd(year, month)]
        : [yearStart(year), yearEnd(year)],
    [mode, year, month]
  );

  const overview = useMemo(() => {
    if (!ready) return null;
    // "Both" is the shared/common household view; each person's tab shows only
    // that person's individual items. Common expenses and common savings only
    // appear on Both; individual ones only on a person's tab.
    const isBoth = who === "Both";
    const scope: Scope = isBoth ? "Common" : who;
    const fIncome = isBoth ? income : income.filter((r) => r.person === who);
    const fExpenses = isBoth ? expenses : [];
    const fPersonal = isBoth ? [] : personal.filter((r) => r.person === who);
    const fBills = bills.filter((r) => r.scope === scope);
    return buildOverview(
      {
        income: fIncome, expenses: fExpenses, personalExpenses: fPersonal,
        bills: fBills,
        incomeCategories: config.incomeCategories,
        expenseCategories: config.expenseCategories,
        billCategories: config.billCategories,
      },
      start, end
    );
  }, [ready, who, start, end, config, income, expenses, personal, bills]);

  // The common pool broken down by category. Needed on an individual tab too,
  // where each person is charged their share of it.
  const commonOverview = useMemo(() => {
    if (!ready) return null;
    return buildOverview(
      {
        income: [], expenses, personalExpenses: [],
        bills: bills.filter((r) => r.scope === "Common"),
        incomeCategories: config.incomeCategories,
        expenseCategories: config.expenseCategories,
        billCategories: config.billCategories,
      },
      start, end
    );
  }, [ready, start, end, config, expenses, bills]);

  // Per-person income split for the two pies: fair share of all spending,
  // invested (savings) and what's left over.
  const splits = useMemo(() => {
    if (!ready) return null;
    return buildIncomeSplits(
      { income, expenses, personalExpenses: personal, bills },
      start, end
    );
  }, [ready, start, end, income, expenses, personal, bills]);

  const settlement = useMemo(() => {
    if (!ready) return null;
    return computeSettlement({ income, expenses, bills, settlements }, start, end);
  }, [ready, start, end, income, expenses, bills, settlements]);

  const years = useMemo(() => yearOptions(), []);

  if (!overview || !commonOverview || !splits || !settlement || !config)
    return <div className="empty">Loading…</div>;

  const p1 = config.p1Name;
  const p2 = config.p2Name;
  const isBoth = who === "Both";

  // On an individual tab the person also carries their income-proportional
  // share of the household's common expenses and bills — without it their
  // "saved" would count the shared spending as free.
  const commonShare = isBoth
    ? null
    : commonShareFor(
        commonOverview.expenses,
        commonOverview.bills,
        who === "P1" ? settlement.shareP1 : settlement.shareP2
      );
  const personSplit = isBoth ? null : who === "P1" ? splits.p1 : splits.p2;
  const totalSaved = isBoth ? overview.totalSaved : personSplit!.saved;

  const totalsBar = [
    { name: "Income", value: overview.totalIncome },
    {
      name: isBoth ? "Common Exp." : "Individual Exp.",
      value: isBoth ? overview.totalExpenses : overview.totalPersonal,
    },
    { name: isBoth ? "Common Bills" : "Individual Bills", value: overview.totalBills },
    ...(commonShare ? [{ name: "Common Share", value: commonShare.total }] : []),
    {
      name: "Invested",
      value: isBoth ? overview.totalSavings : personSplit!.invested,
    },
    { name: "Saved", value: totalSaved },
  ];

  // All money spent, merged by category across the spending sources in scope
  // for this tab. Savings entries keep their "Savings" category, so they get a
  // slice of their own. Common spending is deliberately absent from a person's
  // tab — the shared pies live on Both.
  const spendingByCategory: CategoryTotal[] = (() => {
    const m = new Map<string, number>();
    const sources = isBoth
      ? [...overview.expenses, ...overview.bills, ...overview.savings]
      : [...overview.personal, ...overview.bills, ...overview.savings];
    for (const ct of sources) {
      m.set(ct.category, (m.get(ct.category) ?? 0) + ct.value);
    }
    return [...m].map(([category, value]) => ({ category, value }));
  })();

  return (
    <div>
      <div className="toolbar">
        <div className="segmented">
          {([["Both", "Both"], ["P1", p1], ["P2", p2]] as [Who, string][]).map(
            ([id, label]) => (
              <button
                key={id}
                className={who === id ? "seg active" : "seg"}
                onClick={() => setWho(id)}
              >
                {label}
              </button>
            )
          )}
        </div>
      </div>

      {!isBoth && commonShare && (
        <p className="subtitle" style={{ marginTop: -8 }}>
          Showing <strong>{who === "P1" ? p1 : p2}</strong>: their income, their individual
          expenses and individual bills, plus their{" "}
          <strong>{(commonShare.share * 100).toFixed(1)}%</strong> share of the household’s
          common expenses and bills
          {settlement.usedFallbackShare
            ? " (split 50/50 — no income recorded this period)"
            : " (their share of the period’s income)"}
          . The full shared totals live on the “Both” tab.
        </p>
      )}

      <div className="cards">
        <Card label="Total Income" value={overview.totalIncome} tone="pos" />
        {isBoth ? (
          <Card label="Common Expenses" value={overview.totalExpenses} tone="neg" />
        ) : (
          <Card label="Individual Expenses" value={overview.totalPersonal} tone="neg" />
        )}
        <Card label={isBoth ? "Common Bills" : "Individual Bills"}
              value={overview.totalBills} tone="neg" />
        {commonShare && (
          <Card label="Share of Common" value={commonShare.total} tone="neg" />
        )}
        <Card label="Total Saved" value={totalSaved}
              tone={totalSaved >= 0 ? "pos" : "neg"} />
      </div>

      {who === "Both" && (
        <SettlementPanel
          s={settlement}
          p1={p1}
          p2={p2}
          start={start}
          end={end}
          online={online}
          settlements={settlements ?? []}
          periodLabel={mode === "monthly" ? `${monthName(month)} ${year}` : `${year}`}
        />
      )}

      {/* The two headline pies: each person's income split into their fair
          share of expenses, what they invested and what they saved. */}
      <div className="charts">
        <PieCard title="Spending by category" data={spendingByCategory} />
        <PieCard title="Bills by category" data={overview.bills} />
        <PieCard title="Income by category" data={overview.income} />
        {!isBoth && (
          <PieCard title="Individual expenses by category" data={overview.personal} />
        )}
        {isBoth && <PersonPie title={`${p1} — income split`} split={splits.p1} />}
        {isBoth && <PersonPie title={`${p2} — income split`} split={splits.p2} />}
      </div>

      <div className="chart-card panel" style={{ marginTop: 16 }}>
        <h3>Totals</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={totalsBar}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f4a" />
            <XAxis dataKey="name" stroke="#9aa0bd" />
            <YAxis stroke="#9aa0bd" />
            <Tooltip
              formatter={(v: number) => fmtMoney(v)}
              contentStyle={{ background: "#171a2b", border: "1px solid #2a2f4a" }}
              itemStyle={{ color: "#e7e9f3" }}
              labelStyle={{ color: "#e7e9f3" }}
            />
            <Legend />
            <Bar dataKey="value" name="Amount" fill="#6c8cff" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Period controls live at the bottom so the numbers are the first thing
          you see; the person switcher stays at the top as the view tab. */}
      <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
        {mode === "monthly" && (
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        )}
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

function SettlementPanel({
  s, p1, p2, start, end, online, settlements, periodLabel,
}: {
  s: Settlement; p1: string; p2: string;
  start: string; end: string; online: boolean;
  settlements: SettlementRecord[]; periodLabel: string;
}) {
  const { busy, run } = useBusy();
  const name = (p: "P1" | "P2") => personName(p, { p1, p2 });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  // Transfers already recorded for *this* period — used to undo.
  const recorded = settlements.filter(
    (r) => r.periodStart === start && r.periodEnd === end
  );
  const hasSettlement = Math.abs(s.settledNetP1) > 0.005;

  async function settle() {
    if (!s.from || !s.to || s.amount === 0) return;
    const ok = await confirm({
      title: "Record settlement",
      message: `Record that ${name(s.from)} transferred ${fmtMoney(s.amount)} to ${name(
        s.to
      )} for ${periodLabel}? This clears the balance for this period.`,
      confirmLabel: "Mark settled",
    });
    if (!ok) return;
    await db.settlements.add({
      date: toISO(new Date()),
      periodStart: start,
      periodEnd: end,
      from: s.from,
      to: s.to,
      amount: s.amount,
    });
  }

  async function unsettle() {
    if (!recorded.length) return;
    const ok = await confirm({
      title: "Undo settlement",
      message: `Remove the recorded settlement${
        recorded.length > 1 ? "s" : ""
      } for ${periodLabel}? The balance will show as unsettled again.`,
      confirmLabel: "Undo",
      danger: true,
    });
    if (!ok) return;
    for (const r of recorded) if (r.id != null) await db.settlements.delete(r.id);
  }

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Settlement — {periodLabel}</h3>

      <div className="settle-result">
        <span className="value">
          {s.amount === 0 ? (
            <span className="pos">
              {hasSettlement
                ? `All settled ✓ — transfer recorded for ${periodLabel}.`
                : "All settled — no transfer needed."}
            </span>
          ) : (
            <>
              <strong>{name(s.from!)}</strong> transfers{" "}
              <strong className="amount">{fmtMoney(s.amount)}</strong> to{" "}
              <strong>{name(s.to!)}</strong>
              {hasSettlement && (
                <span className="subtitle" style={{ marginLeft: 8 }}>
                  · {fmtMoney(Math.abs(s.settledNetP1))} already transferred
                </span>
              )}
            </>
          )}
        </span>
        <div className="settle-actions">
          {s.amount > 0 && (
            <button className="primary" onClick={() => run(settle)} disabled={!online || busy}>
              Settle
            </button>
          )}
          {recorded.length > 0 && (
            <button className="ghost danger" onClick={() => run(unsettle)} disabled={!online || busy}>
              Undo settlement
            </button>
          )}
        </div>
      </div>

      {s.usedFallbackShare && (
        <p className="subtitle" style={{ marginTop: 8 }}>
          No income recorded this period — split 50/50 as a fallback.
        </p>
      )}

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th></th>
            <th className="num">Income</th>
            <th className="num">Share</th>
            <th className="num">Fair share</th>
            <th className="num">Paid (out of pocket)</th>
            <th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          <SettleRow name={p1} income={s.incomeP1} share={s.shareP1}
                     fair={s.fairP1} paid={s.paidP1} balance={s.balanceP1} pct={pct} />
          <SettleRow name={p2} income={s.incomeP2} share={s.shareP2}
                     fair={s.fairP2} paid={s.paidP2} balance={-s.balanceP1} pct={pct} />
          <tr>
            <td><strong>Shared pool</strong></td>
            <td className="num"><strong>{fmtMoney(s.totalIncome)}</strong></td>
            <td className="num">100%</td>
            <td className="num"><strong>{fmtMoney(s.pool)}</strong></td>
            <td className="num"><strong>{fmtMoney(s.pool)}</strong></td>
            <td className="num">{fmtMoney(0)}</td>
          </tr>
        </tbody>
      </table>
      <p className="subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
        Pool = common expenses + bills tagged “Common”. Savings into investments
        are not pooled. Fair share = income % × pool. A positive balance means
        that person overpaid and is owed.
      </p>
    </div>
  );
}

function SettleRow({
  name, income, share, fair, paid, balance, pct,
}: {
  name: string; income: number; share: number; fair: number;
  paid: number; balance: number; pct: (x: number) => string;
}) {
  return (
    <tr>
      <td><strong>{name}</strong></td>
      <td className="num">{fmtMoney(income)}</td>
      <td className="num">{pct(share)}</td>
      <td className="num">{fmtMoney(fair)}</td>
      <td className="num">{fmtMoney(paid)}</td>
      <td className={"num " + (balance > 0 ? "pos" : balance < 0 ? "neg" : "")}>
        {balance > 0 ? "+" : ""}{fmtMoney(balance)}
      </td>
    </tr>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone?: "pos" | "neg" }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className={"value " + (tone ?? "")}>{fmtMoney(value)}</div>
    </div>
  );
}

/** One person's income split: expenses / invested / saved. */
function PersonPie({ title, split }: { title: string; split: IncomeSplit }) {
  const data: CategoryTotal[] = [
    { category: "Expenses", value: Math.max(0, split.expenses) },
    { category: "Invested", value: Math.max(0, split.invested) },
    { category: "Saved", value: Math.max(0, split.saved) },
  ];
  const note =
    split.saved < 0
      ? `Overspent by ${fmtMoney(-split.saved)} this period.`
      : split.income === 0
      ? "No income recorded for this person."
      : undefined;
  return <PieCard title={title} data={data} note={note} />;
}

function PieCard({
  title, data, note,
}: {
  title: string; data: CategoryTotal[]; note?: string;
}) {
  // Charts ignore zero/negative slices (matches the overview hiding blanks).
  const slices = data.filter((d) => d.value > 0);
  return (
    <div className="chart-card panel">
      <h3>{title}</h3>
      {slices.length === 0 ? (
        <div className="empty">No data for this period.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="category"
              cy="42%"
              outerRadius={80}
            >
              {slices.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => fmtMoney(v)}
              contentStyle={{ background: "#171a2b", border: "1px solid #2a2f4a" }}
              itemStyle={{ color: "#e7e9f3" }}
              labelStyle={{ color: "#e7e9f3" }}
            />
            {/* Category names live in a wrapping legend instead of radial
                outside-labels, which clipped off-screen on narrow phones. */}
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              wrapperStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      {note && (
        <p className="subtitle" style={{ marginTop: 8, marginBottom: 0 }}>{note}</p>
      )}
    </div>
  );
}
