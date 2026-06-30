import { useMemo, useState } from "react";
import { useLiveQuery } from "../db/live";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Legend, CartesianGrid,
} from "recharts";
import { db } from "../db/db";
import type { Person, SettlementRecord } from "../db/types";
import {
  buildOverview, computeSettlement, monthStart, monthEnd, yearStart, yearEnd,
  toISO, type CategoryTotal, type Settlement,
} from "../lib/finance";
import { fmtMoney } from "../lib/format";
import { useOnline } from "../lib/useOnline";
import { confirm } from "../lib/confirm";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
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
  const investments = useLiveQuery(() => db.investments.toArray(), []);
  const bills = useLiveQuery(() => db.bills.toArray(), []);
  const settlements = useLiveQuery(() => db.settlements.toArray(), []);

  const ready =
    config && income && expenses && personal && investments && bills && settlements;

  const [start, end] = useMemo(
    () =>
      mode === "monthly"
        ? [monthStart(year, month), monthEnd(year, month)]
        : [yearStart(year), yearEnd(year)],
    [mode, year, month]
  );

  const overview = useMemo(() => {
    if (!ready) return null;
    // Person filter: income by person, expenses/bills by who actually paid.
    // Investments carry no person attribution, so they show in full in every view.
    const fIncome = who === "Both" ? income : income.filter((r) => r.person === who);
    const fExpenses = who === "Both" ? expenses : expenses.filter((r) => r.paidBy === who);
    const fPersonal = who === "Both" ? personal : personal.filter((r) => r.person === who);
    const fBills = who === "Both" ? bills : bills.filter((r) => r.paidBy === who);
    return buildOverview(
      {
        income: fIncome, expenses: fExpenses, personalExpenses: fPersonal,
        bills: fBills, investments,
        incomeCategories: config.incomeCategories,
        expenseCategories: config.expenseCategories,
        billCategories: config.billCategories,
        investmentCategories: config.investmentCategories,
      },
      start, end
    );
  }, [ready, who, start, end, config, income, expenses, personal, investments, bills]);

  const settlement = useMemo(() => {
    if (!ready) return null;
    return computeSettlement({ income, expenses, bills, settlements }, start, end);
  }, [ready, start, end, income, expenses, bills, settlements]);

  const years = useMemo(() => {
    const base = now.getFullYear();
    return Array.from({ length: 8 }, (_, i) => base - 4 + i);
  }, [now]);

  if (!overview || !settlement || !config) return <div className="empty">Loading…</div>;

  const p1 = config.p1Name;
  const p2 = config.p2Name;

  const totalsBar = [
    { name: "Income", value: overview.totalIncome },
    { name: "Expenses", value: overview.totalExpenses },
    { name: "Individual", value: overview.totalPersonal },
    { name: "Bills", value: overview.totalBills },
    { name: "Investments", value: overview.totalInvestments },
    { name: "Saved", value: overview.totalSaved },
  ];

  // All money spent, merged by category across every spending source
  // (common expenses + individual expenses + bills). Same category name from
  // different sources collapses into a single slice.
  const spendingByCategory: CategoryTotal[] = (() => {
    const m = new Map<string, number>();
    for (const ct of [...overview.expenses, ...overview.personal, ...overview.bills]) {
      m.set(ct.category, (m.get(ct.category) ?? 0) + ct.value);
    }
    return [...m].map(([category, value]) => ({ category, value }));
  })();

  // Where the income went: each outflow bucket plus what's left as savings.
  const moneyDistribution: CategoryTotal[] = [
    { category: "Common Expenses", value: overview.totalExpenses },
    { category: "Individual Expenses", value: overview.totalPersonal },
    { category: "Bills", value: overview.totalBills },
    { category: "Investments", value: overview.totalInvestments },
    { category: "Saved", value: overview.totalSaved },
  ];

  return (
    <div>
      <h2>Dashboard</h2>
      <div className="toolbar">
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

        <div className="segmented" style={{ marginLeft: "auto" }}>
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

      {who !== "Both" && (
        <p className="subtitle" style={{ marginTop: -8 }}>
          Showing <strong>{who === "P1" ? p1 : p2}</strong>: their income, their individual
          expenses, and what they paid out of pocket (common expenses + bills they fronted).
          Investments aren’t attributed to a person, so they appear in full.
        </p>
      )}

      <div className="cards">
        <Card label="Total Income" value={overview.totalIncome} tone="pos" />
        <Card label="Common Expenses" value={overview.totalExpenses} tone="neg" />
        <Card label="Individual Expenses" value={overview.totalPersonal} tone="neg" />
        <Card label="Total Bills" value={overview.totalBills} tone="neg" />
        <Card label="Total Investments" value={overview.totalInvestments} />
        <Card label="Total Saved" value={overview.totalSaved}
              tone={overview.totalSaved >= 0 ? "pos" : "neg"} />
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
          periodLabel={mode === "monthly" ? `${MONTHS[month - 1]} ${year}` : `${year}`}
        />
      )}

      <div className="charts">
        <PieCard title="Income by category" data={overview.income} />
        <PieCard title="Common expenses by category" data={overview.expenses} />
        <PieCard title="Individual expenses by category" data={overview.personal} />
        <PieCard title="Bills by category" data={overview.bills} />
        <PieCard title="Investments by category" data={overview.investments} />
        <PieCard title="Total spending by category" data={spendingByCategory} />
        <PieCard title="Total money distribution" data={moneyDistribution} />
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
            />
            <Legend />
            <Bar dataKey="value" name="Amount" fill="#6c8cff" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
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
  const name = (p: "P1" | "P2") => (p === "P1" ? p1 : p2);
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
            <button className="primary" onClick={settle} disabled={!online}>
              Settle
            </button>
          )}
          {recorded.length > 0 && (
            <button className="ghost danger" onClick={unsettle} disabled={!online}>
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
        Pool = common expenses + bills tagged “Common”. Fair share = income % × pool.
        A positive balance means that person overpaid and is owed.
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

function PieCard({ title, data }: { title: string; data: CategoryTotal[] }) {
  // Charts ignore zero/negative slices (matches the overview hiding blanks).
  const slices = data.filter((d) => d.value > 0);
  return (
    <div className="chart-card panel">
      <h3>{title}</h3>
      {slices.length === 0 ? (
        <div className="empty">No data for this period.</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="category"
              outerRadius={90}
              label={(e: { category: string }) => e.category}
            >
              {slices.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number) => fmtMoney(v)}
              contentStyle={{ background: "#171a2b", border: "1px solid #2a2f4a" }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
