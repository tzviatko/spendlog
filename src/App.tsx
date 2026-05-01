import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import type { User } from "@supabase/supabase-js";
import { supabase, type ExpenseRow } from "./lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────
interface Profile {
  id: string;
  email: string;
  role: "admin" | "user";
}

interface Expense {
  id: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  rate: number;
  payment: string;
  notes: string;
  usdAmount: number;
}

type CatEntry = { label: string; tw: string; hex: string };

// ── Constants ──────────────────────────────────────────────────────────────
const CAT: CatEntry[] = [
  { label: "Food & Groceries",           tw: "bg-emerald-100 text-emerald-800",   hex: "#6ee7b7" },
  { label: "Meals & Entertainment",      tw: "bg-amber-100 text-amber-800",       hex: "#fcd34d" },
  { label: "Healthcare",                 tw: "bg-rose-100 text-rose-800",         hex: "#fda4af" },
  { label: "Vehicles, Fuel, Parking",   tw: "bg-sky-100 text-sky-800",           hex: "#7dd3fc" },
  { label: "Toiletries, Hair, Nails",   tw: "bg-pink-100 text-pink-800",         hex: "#f9a8d4" },
  { label: "Fortunes Gate renovation",  tw: "bg-orange-100 text-orange-800",     hex: "#fdba74" },
  { label: "Fortunes Gate Cottage",     tw: "bg-yellow-100 text-yellow-700",     hex: "#fde68a" },
  { label: "Fortunes Gate Garden",      tw: "bg-lime-100 text-lime-800",         hex: "#bef264" },
  { label: "Tawana Pay",                tw: "bg-indigo-100 text-indigo-800",     hex: "#a5b4fc" },
  { label: "Other",                     tw: "bg-gray-100 text-gray-600",         hex: "#d1d5db" },
];

const EXTRA_COLORS: Omit<CatEntry, "label">[] = [
  { tw: "bg-teal-100 text-teal-800",    hex: "#5eead4" },
  { tw: "bg-lime-100 text-lime-800",    hex: "#bef264" },
  { tw: "bg-fuchsia-100 text-fuchsia-800", hex: "#f0abfc" },
  { tw: "bg-red-100 text-red-700",      hex: "#fca5a5" },
  { tw: "bg-yellow-100 text-yellow-700", hex: "#fde68a" },
];

const PAYMENTS = ["Cash","Card ZIM","Card USA","EcoCash","Transfer external","Transfer internal internet","Transfer internal mobile"];

const randomPassword = () => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};

// Fallback helpers for base categories (custom cats fall back to gray)
const catTw  = (l: string, all?: CatEntry[]) => (all ?? CAT).find(c => c.label === l)?.tw  ?? "bg-gray-100 text-gray-600";
const catHex = (l: string, all?: CatEntry[]) => (all ?? CAT).find(c => c.label === l)?.hex ?? "#d1d5db";

// ── Helpers ────────────────────────────────────────────────────────────────
const nowZW = () => {
  const zw = new Date(Date.now() + 2 * 3600 * 1000);
  return zw.toISOString().slice(0, 16);
};

const calcFeesAndTax = (amountUsd: number, payment: string) => {
  let fees = 0, tax = 0;
  const amt = amountUsd || 0;
  if (payment === "Card ZIM")                   { fees = Math.max(amt * 0.0165, 1.5) + 0.2 + amt * 0.006; tax = amt * 0.02; }
  else if (payment === "EcoCash")               { fees = amt * 0.013; tax = amt > 5 ? amt * 0.02 : 0; }
  else if (payment === "Transfer external")     { fees = 3; tax = amt * 0.02; }
  else if (payment === "Transfer internal internet") { fees = 1; tax = amt * 0.02; }
  else if (payment === "Transfer internal mobile")   { fees = 2; tax = amt * 0.02; }
  return { fees: parseFloat(fees.toFixed(2)), tax: parseFloat(tax.toFixed(2)) };
};

const calcUsdBase = (amount: string | number, rate: string | number) =>
  parseFloat(((parseFloat(String(amount)) || 0) / (parseFloat(String(rate)) || 1)).toFixed(2));
const calcTotal = (usdBase: number, fees: number, tax: number) =>
  parseFloat((usdBase + fees + tax).toFixed(2));

// Local-timezone-safe date helpers (avoids UTC shift when using toISOString on midnight dates)
const localIso = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const firstOfMonth = (y: number, m0: number) => localIso(new Date(y, m0, 1));      // m0 is 0-indexed
const lastOfMonth  = (y: number, m0: number) => localIso(new Date(y, m0 + 1, 0));  // day-0 of next month = last day of m0

const fmtAmt  = (n: number, dp = 2) => (n || 0).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtUsd  = (n: number) => "$" + fmtAmt(n);
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDateLabel = (d: string) => d ? new Date(d + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

const rowToExpense = (row: ExpenseRow): Expense => ({
  id: row.id, date: row.date, merchant: row.merchant,
  category: row.category, amount: Number(row.amount), rate: Number(row.rate),
  payment: row.payment, notes: row.notes || "",
  usdAmount: Number(row.usd_amount),
});

// ── Shared styles ──────────────────────────────────────────────────────────
const inputCls    = "w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300";
const readonlyCls = "w-full rounded-lg border border-gray-100 px-3 py-2.5 text-sm bg-gray-50 cursor-not-allowed";

// ── Field wrapper ──────────────────────────────────────────────────────────
function Field({ label, children, sub }: { label: string; children: React.ReactNode; sub?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
        {label}{sub && <span className="normal-case ml-1 text-gray-300">{sub}</span>}
      </label>
      {children}
    </div>
  );
}

// ── Stacked bar chart ──────────────────────────────────────────────────────
function StackedChart({ expenses, allCats, onMonthClick, activeMonth, fromDate, toDate }: {
  expenses: Expense[]; allCats: CatEntry[];
  onMonthClick: (key: string) => void; activeMonth: string | null;
  fromDate: string; toDate: string;
}) {
  const months = useMemo(() => {
    const now = new Date();
    // Derive start/end month from filters, falling back to last 4 months
    let startY: number, startM: number, endY: number, endM: number;
    if (fromDate) {
      const d = new Date(fromDate + "T12:00");
      startY = d.getFullYear(); startM = d.getMonth();
    } else if (expenses.length > 0) {
      const earliest = expenses.reduce((a, b) => a.date < b.date ? a : b);
      const d = new Date(earliest.date);
      startY = d.getFullYear(); startM = d.getMonth();
    } else {
      startY = now.getFullYear(); startM = now.getMonth() - 3;
    }
    if (toDate) {
      const d = new Date(toDate + "T12:00");
      endY = d.getFullYear(); endM = d.getMonth();
    } else {
      endY = now.getFullYear(); endM = now.getMonth();
    }
    const spanYears = endY > startY;
    const out = [];
    let y = startY, m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      const d = new Date(y, m, 1);
      const shortMonth = d.toLocaleString("default", { month: "short" });
      const label = spanYears ? `${shortMonth} '${String(y).slice(2)}` : shortMonth;
      const entries = expenses.filter(e => e.date.startsWith(key));
      const byCat: Record<string, number> = {};
      entries.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.usdAmount; });
      const total = Object.values(byCat).reduce((s, v) => s + v, 0);
      out.push({ key, label, byCat, total: parseFloat(total.toFixed(2)) });
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }, [expenses, fromDate, toDate]);

  const isCombined = months.length > 6;

  const displayBars = useMemo(() => {
    if (!isCombined) return months;
    const byCat: Record<string, number> = {};
    months.forEach(mo => {
      Object.entries(mo.byCat).forEach(([cat, val]) => { byCat[cat] = (byCat[cat] || 0) + val; });
    });
    const total = parseFloat(Object.values(byCat).reduce((s, v) => s + v, 0).toFixed(2));
    const firstDate = new Date(months[0].key + "-01T12:00");
    const lastDate = new Date(months[months.length - 1].key + "-01T12:00");
    const fmt = (d: Date) => d.toLocaleString("default", { month: "short", year: "numeric" });
    const label = `${fmt(firstDate)} – ${fmt(lastDate)}`;
    return [{ key: "combined", label, byCat, total }];
  }, [months, isCombined]);

  const max = Math.max(...displayBars.map(m => m.total), 1);
  return (
    <div>
      <div className={`flex items-end gap-3 ${isCombined ? "justify-center" : ""}`} style={{ height: 120 }}>
        {displayBars.map(m => {
          const isActive = !isCombined && activeMonth === m.key;
          const barH = Math.max((m.total / max) * 100, m.total > 0 ? 4 : 0);
          const segs = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]);
          return (
            <button key={m.key}
              onClick={() => { if (!isCombined) onMonthClick(m.key); }}
              className={`flex flex-col items-center gap-1 focus:outline-none ${isCombined ? "cursor-default w-24" : "flex-1"}`}
              style={{ height: "100%" }}>
              <span className="text-gray-400 mb-1" style={{ fontSize: 10 }}>{m.total > 0 ? fmtUsd(m.total) : ""}</span>
              <div className="w-full flex flex-col justify-end overflow-hidden"
                style={{ height: "75%", border: isActive ? "2px solid #4f46e5" : "2px solid transparent", borderRadius: 6 }}>
                {m.total === 0
                  ? <div className="w-full bg-gray-100" style={{ height: "8%" }} />
                  : segs.map(([cat, val]) => (
                    <div key={cat} style={{ height: `${(val / m.total) * barH}%`, background: catHex(cat, allCats), minHeight: 2 }} />
                  ))}
              </div>
              <span className={`font-medium mt-1 text-center ${isActive ? "text-indigo-600" : "text-gray-400"}`}
                style={{ fontSize: isCombined ? 10 : 11 }}>{m.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
        {allCats.filter(c => expenses.some(e => e.category === c.label)).map(c => (
          <span key={c.label} className="flex items-center gap-1 text-gray-500" style={{ fontSize: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.hex, display: "inline-block" }} />
            {c.label}
          </span>
        ))}
      </div>
      {!isCombined && activeMonth && (
        <button onClick={() => onMonthClick(activeMonth)} className="mt-2 text-xs text-indigo-500 font-medium">Clear month filter</button>
      )}
    </div>
  );
}

// ── Pie chart ──────────────────────────────────────────────────────────────
function PieChart({ expenses, allCats, catFilter, onCatClick, onClearCats }: {
  expenses: Expense[]; allCats: CatEntry[]; catFilter: string[];
  onCatClick: (cat: string) => void; onClearCats: () => void;
}) {
  const data = useMemo(() => {
    const m: Record<string, number> = {};
    expenses.forEach(e => { m[e.category] = (m[e.category] || 0) + e.usdAmount; });
    const total = Object.values(m).reduce((s, v) => s + v, 0);
    if (total === 0) return [];
    let angle = -Math.PI / 2;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([cat, val]) => {
      const sweep = Math.max((val / total) * 2 * Math.PI, 0.001);
      const s = angle; angle += sweep;
      return { cat, val, startAngle: s, endAngle: angle, pct: val / total };
    });
  }, [expenses]);

  const total = data.reduce((s, d) => s + d.val, 0);
  const cx = 100, cy = 100, r = 82, ri = 50;
  const polar = (a: number, rd: number): [number, number] => [cx + rd * Math.cos(a), cy + rd * Math.sin(a)];
  const slicePath = (sa: number, ea: number) => {
    const [x1,y1]=polar(sa,r),[x2,y2]=polar(ea,r),[x3,y3]=polar(ea,ri),[x4,y4]=polar(sa,ri);
    return `M${x1},${y1} A${r},${r} 0 ${ea-sa>Math.PI?1:0},1 ${x2},${y2} L${x3},${y3} A${ri},${ri} 0 ${ea-sa>Math.PI?1:0},0 ${x4},${y4}Z`;
  };

  if (data.length === 0) return <div className="py-6 text-center text-sm text-gray-400">No expenses in this period</div>;

  return (
    <div>
      <div className="flex justify-center mb-3">
        <svg viewBox="0 0 200 200" width="170" height="170">
          {data.map(d => (
            <path key={d.cat} d={slicePath(d.startAngle, d.endAngle)}
              fill={catHex(d.cat, allCats)}
              opacity={catFilter.length === 0 || catFilter.includes(d.cat) ? 1 : 0.2}
              stroke="white" strokeWidth="2"
              style={{ cursor: "pointer", transition: "opacity 0.15s" }}
              onClick={() => onCatClick(d.cat)} />
          ))}
          <text x="100" y="95" textAnchor="middle" fontSize="10" fill="#9ca3af" fontFamily="sans-serif">Total</text>
          <text x="100" y="113" textAnchor="middle" fontSize="14" fontWeight="700" fill="#1f2937" fontFamily="sans-serif">{fmtUsd(total)}</text>
        </svg>
      </div>
      <div className="space-y-0.5">
        {data.map(d => (
          <button key={d.cat} onClick={() => onCatClick(d.cat)}
            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-opacity active:scale-95 ${catFilter.length === 0 || catFilter.includes(d.cat) ? "" : "opacity-30"}`}>
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: catHex(d.cat, allCats) }} />
            <span className="text-xs text-gray-600 flex-1 truncate">{d.cat}</span>
            <span className="text-xs font-semibold text-gray-800">{fmtUsd(d.val)}</span>
            <span className="text-xs text-gray-400 w-8 text-right">{(d.pct * 100).toFixed(0)}%</span>
          </button>
        ))}
      </div>
      {catFilter.length > 0 && (
        <button onClick={onClearCats} className="mt-2 text-xs text-indigo-500 font-medium">Clear category filter</button>
      )}
    </div>
  );
}

// ── Merchant combobox ──────────────────────────────────────────────────────
function MerchantCombobox({ value, onChange, merchants, onSelectExisting }: {
  value: string;
  onChange: (v: string) => void;
  merchants: string[];
  onSelectExisting?: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!value.trim()) return merchants.slice(0, 50);
    const q = value.toLowerCase();
    return merchants.filter(m => m.toLowerCase().includes(q)).slice(0, 50);
  }, [value, merchants]);

  const select = (m: string) => {
    onChange(m);
    setOpen(false);
    onSelectExisting?.(m);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlight]) select(filtered[highlight]); else setOpen(false); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => { setOpen(true); setHighlight(0); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKey}
        placeholder="Search or type new…"
        className={inputCls}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.map((m, i) => (
            <li key={m} onMouseDown={() => select(m)}
              className={`px-3 py-2 text-sm cursor-pointer ${i === highlight ? "bg-indigo-50 text-indigo-700" : "text-gray-700 hover:bg-gray-50"}`}>
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Auth screen ────────────────────────────────────────────────────────────
function AuthScreen() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!email || !password) { setError("Email and password are required."); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message === "Invalid login credentials" ? "Incorrect email or password." : err.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-6 max-w-sm w-full space-y-5">
        <div className="text-center space-y-1">
          <p className="text-xl font-bold text-indigo-600">Spendlog</p>
          <p className="text-sm text-gray-500">Sign in to your account</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Email</label>
            <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} className={inputCls} placeholder="you@example.com" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Password</label>
            <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSubmit()} className={inputCls} placeholder="••••••••" />
          </div>
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        </div>
        <button onClick={handleSubmit} disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium text-sm py-3 rounded-xl transition-all active:scale-95">
          {loading ? "Please wait…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

// ── Edit modal ─────────────────────────────────────────────────────────────
function EditModal({ expense, merchants, allCats, onSave, onClose }: {
  expense: Expense; merchants: string[]; allCats: CatEntry[];
  onSave: (updated: Expense) => void; onClose: () => void;
}) {
  const [f, setF] = useState({
    date: expense.date, merchant: expense.merchant,
    category: expense.category, amount: String(expense.amount),
    rate: String(expense.rate), payment: expense.payment, notes: expense.notes || "",
  });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const usdBase = calcUsdBase(f.amount, f.rate);
  const { fees, tax } = calcFeesAndTax(usdBase, f.payment);
  const usdTotal = calcTotal(usdBase, fees, tax);

  return (
    <div className="absolute inset-0 z-50 bg-black/40 flex items-end" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full bg-white rounded-t-2xl max-h-[92vh] overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom,16px)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Edit Expense</h2>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="Date & Time">
            <input type="datetime-local" value={f.date} onChange={e => set("date", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Merchant">
            <MerchantCombobox value={f.merchant} onChange={v => set("merchant", v)} merchants={merchants} />
          </Field>
          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              {allCats.map(c => (
                <button key={c.label} onClick={() => set("category", c.label)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${f.category === c.label ? c.tw + " border-transparent ring-2 ring-indigo-300" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <input type="number" min="0" step="0.01" value={f.amount} onChange={e => set("amount", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Rate → USD">
              <input type="number" min="0" step="0.01" value={f.rate} onChange={e => set("rate", e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Payment Method">
            <div className="flex flex-wrap gap-2">
              {PAYMENTS.map(m => (
                <button key={m} onClick={() => set("payment", m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${f.payment === m ? "bg-indigo-600 text-white border-transparent" : "bg-gray-50 text-gray-600 border-gray-200"}`}>
                  {m}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="USD Base"><div className={readonlyCls + " text-gray-400"}>{fmtAmt(usdBase)}</div></Field>
            <Field label="Fees"><div className={readonlyCls + " text-gray-400"}>{fmtUsd(fees)}</div></Field>
            <Field label="IMT Tax"><div className={readonlyCls + " text-gray-400"}>{fmtUsd(tax)}</div></Field>
          </div>
          <Field label="USD Total">
            <div className="w-full rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-sm font-semibold text-indigo-700">{fmtUsd(usdTotal)}</div>
          </Field>
          <Field label="Notes">
            <textarea rows={2} value={f.notes} onChange={e => set("notes", e.target.value)} className={inputCls + " resize-none"} />
          </Field>
          <button onClick={() => {
            const merchant = f.merchant;
            if (!merchant || !(parseFloat(f.amount) > 0)) return;
            const ub = calcUsdBase(f.amount, f.rate);
            const { fees: fe, tax: tx } = calcFeesAndTax(ub, f.payment);
            onSave({ ...expense, date: f.date, merchant, category: f.category, amount: parseFloat(f.amount), rate: parseFloat(f.rate) || 1, payment: f.payment, notes: f.notes, usdAmount: calcTotal(ub, fe, tx) });
          }} className="w-full bg-indigo-600 text-white font-medium text-sm py-3 rounded-xl active:scale-95 transition-all">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]       = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView]       = useState("entry");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState<{ msg: string; type: string } | null>(null);
  const [customCatLabels, setCustomCatLabels] = useState<string[]>([]);
  const [adminSlide, setAdminSlide]           = useState<HTMLDivElement | null>(null);
  const [historySlide, setHistorySlide]       = useState<HTMLDivElement | null>(null);
  const [addingCat, setAddingCat]             = useState(false);
  const [newCatName, setNewCatName]           = useState("");
  const newCatInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const fileRef        = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    date: nowZW(), merchant: "", merchantInput: "",
    category: "Food & Groceries", amount: "", rate: "1.00",
    payment: "Cash", notes: "", receiptName: "",
  });

  // ── Carousel drag state ──
  const [dragX, setDragX]     = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragXRef     = useRef(0);
  const touchStartX  = useRef(0);
  const touchStartY  = useRef(0);
  const dragDirRef   = useRef<"h" | "v" | null>(null);

  const isPrivileged = profile?.role === "admin";
  const views = useMemo(() => {
    const v = ["entry", "dashboard"];
    if (isPrivileged) v.push("admin");
    return v;
  }, [isPrivileged]);
  const currentIndex = Math.max(views.indexOf(view), 0);
  const n = views.length;

  // Stable refs for callbacks
  const viewsRef        = useRef(views);
  const viewRef         = useRef(view);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => { viewsRef.current = views; },        [views]);
  useEffect(() => { viewRef.current = view; },          [view]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const allCats = useMemo(() => [
    ...CAT,
    ...customCatLabels.map((label, i) => ({ label, ...EXTRA_COLORS[i % EXTRA_COLORS.length] })),
  ], [customCatLabels]);

  const merchants = useMemo(() => {
    const freq: Record<string, number> = {};
    expenses.forEach(e => { freq[e.merchant] = (freq[e.merchant] || 0) + 1; });
    return Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
  }, [expenses]);

  // ── Load custom categories from localStorage ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem("spendlog_custom_cats");
      if (saved) setCustomCatLabels(JSON.parse(saved));
    } catch {}
  }, []);

  // ── Auth ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (!session) setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data }) => { if (data) setProfile(data as Profile); });
  }, [user]);

  // ── Load expenses ──
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const query = supabase.from("expenses").select("*").order("date", { ascending: false });
    query.then(async ({ data, error }) => {
      if (!error && data) {
        setExpenses((data as ExpenseRow[]).map(rowToExpense));
        const unowned = (data as ExpenseRow[]).filter(r => r.user_id === null);
        if (unowned.length > 0) {
          await supabase.from("expenses").update({ user_id: user.id }).is("user_id", null);
        }
      }
      setLoading(false);
    });
  }, [user, profile?.role]);

  // Reset to entry if current view is removed (e.g., role changes)
  useEffect(() => {
    if (!views.includes(view)) setView("entry");
  }, [views, view]);

  // Auto-focus add-category input
  useEffect(() => {
    if (addingCat) newCatInputRef.current?.focus();
  }, [addingCat]);

  // ── Touch handlers ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    dragDirRef.current = null;
    dragXRef.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!dragDirRef.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      dragDirRef.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (dragDirRef.current !== "h") return;
    const ci = currentIndexRef.current;
    const nn = viewsRef.current.length;
    let eff = dx;
    if ((ci === 0 && dx > 0) || (ci === nn - 1 && dx < 0)) eff = dx * 0.2;
    dragXRef.current = eff;
    setDragging(true);
    setDragX(eff);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (dragDirRef.current !== "h") { dragDirRef.current = null; return; }
    dragDirRef.current = null;
    const dx = dragXRef.current;
    dragXRef.current = 0;
    setDragging(false);
    setDragX(0);
    const ci = currentIndexRef.current;
    const vs = viewsRef.current;
    if (dx < -70 && ci < vs.length - 1) setView(vs[ci + 1]);
    else if (dx > 70 && ci > 0) setView(vs[ci - 1]);
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 2500);
  };

  const usdBase = calcUsdBase(form.amount, form.rate);
  const { fees, tax } = calcFeesAndTax(usdBase, form.payment);
  const usdTotal = calcTotal(usdBase, fees, tax);

  const handleSave = async () => {
    const merchant = form.merchant;
    if (!merchant) { showToast("Merchant required", "error"); return; }
    if (!(parseFloat(form.amount) > 0)) { showToast("Amount must be > 0", "error"); return; }
    const ub = calcUsdBase(form.amount, form.rate);
    const { fees: fe, tax: tx } = calcFeesAndTax(ub, form.payment);
    const usdAmount = calcTotal(ub, fe, tx);
    const { data, error } = await supabase.from("expenses").insert({
      date: form.date, merchant, category: form.category,
      amount: parseFloat(form.amount), rate: parseFloat(form.rate) || 1,
      payment: form.payment, notes: form.notes, usd_amount: usdAmount,
      user_id: user?.id,
    }).select().single();
    if (error) { showToast("Failed to save", "error"); return; }
    setExpenses(p => [rowToExpense(data as ExpenseRow), ...p]);
    setForm(f => ({ date: nowZW(), merchant: "", merchantInput: "", category: "Food & Groceries", amount: "", rate: "1.00", payment: f.payment, notes: "", receiptName: "" }));
    showToast("Expense saved!");
  };

  const handleUpdate = async (updated: Expense) => {
    const { error } = await supabase.from("expenses").update({
      date: updated.date, merchant: updated.merchant, category: updated.category,
      amount: updated.amount, rate: updated.rate, payment: updated.payment,
      notes: updated.notes, usd_amount: updated.usdAmount,
    }).eq("id", updated.id);
    if (error) { showToast("Failed to update", "error"); return; }
    setExpenses(p => p.map(e => e.id === updated.id ? updated : e));
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) { showToast("Failed to delete", "error"); return; }
    setExpenses(p => p.filter(e => e.id !== id));
  };

  const confirmAddCat = () => {
    const label = newCatName.trim();
    if (!label || allCats.some(c => c.label.toLowerCase() === label.toLowerCase())) {
      setAddingCat(false); setNewCatName(""); return;
    }
    const newLabels = [...customCatLabels, label];
    setCustomCatLabels(newLabels);
    try { localStorage.setItem("spendlog_custom_cats", JSON.stringify(newLabels)); } catch {}
    set("category", label);
    setAddingCat(false); setNewCatName("");
  };

  if (authLoading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  if (!user) return <AuthScreen />;

  const tabLabels: Record<string, string> = { entry: "Add", dashboard: "History", admin: "Admin" };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-md
          ${toast.type === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
          {toast.msg}
        </div>
      )}

      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 shrink-0 z-40">
        <div className="max-w-xl mx-auto px-4 flex items-center justify-between h-14">
          <span className="text-indigo-600 font-semibold text-sm">Spendlog</span>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {views.map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${view === v ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500"}`}>
                {tabLabels[v]}
              </button>
            ))}
          </div>
          <button onClick={() => supabase.auth.signOut()} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Sign out
          </button>
        </div>
      </nav>

      {/* Slides */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div
          style={{
            display: "flex", height: "100%",
            width: `${n * 100}%`,
            transform: `translateX(calc(-${currentIndex * (100 / n)}% + ${dragging ? dragX : 0}px))`,
            transition: dragging ? "none" : "transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
            willChange: "transform",
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* ── ADD slide ─────────────────────────────────────────── */}
          <div style={{ width: `${100 / n}%`, height: "100%", display: "flex", flexDirection: "column", touchAction: "pan-y" }}>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <div className="max-w-xl mx-auto px-4 pt-5 pb-4 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">New Expense</p>
                <Field label="Date & Time">
                  <div className="relative" style={{ width: "50%" }}>
                    <div className={inputCls + " pointer-events-none"}>
                      {form.date ? `${fmtDate(form.date)} ${fmtTime(form.date)}` : "Select date & time"}
                    </div>
                    <input type="datetime-local" value={form.date} onChange={e => set("date", e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </div>
                </Field>
                <Field label="Merchant">
                  <MerchantCombobox
                    value={form.merchant || form.merchantInput}
                    onChange={v => { set("merchant", v); set("merchantInput", ""); }}
                    merchants={merchants}
                    onSelectExisting={m => {
                      const last = expenses.find(ex => ex.merchant === m);
                      if (last) set("category", last.category);
                      setTimeout(() => amountInputRef.current?.focus(), 50);
                    }}
                  />
                </Field>
                <Field label="Category">
                  <div className="flex flex-wrap gap-2">
                    {allCats.map(c => (
                      <button key={c.label} onClick={() => set("category", c.label)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                          ${form.category === c.label ? c.tw + " border-transparent ring-2 ring-indigo-300" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                        {c.label}
                      </button>
                    ))}
                    {addingCat ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={newCatInputRef}
                          value={newCatName}
                          onChange={e => setNewCatName(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") confirmAddCat(); if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); } }}
                          maxLength={28}
                          placeholder="New category…"
                          className="w-32 rounded-full border border-indigo-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                        <button onClick={confirmAddCat} className="text-xs text-indigo-600 font-medium px-1.5 py-1 rounded-full hover:bg-indigo-50 transition-colors">Add</button>
                        <button onClick={() => { setAddingCat(false); setNewCatName(""); }} className="text-xs text-gray-400 px-1 py-1 rounded-full hover:bg-gray-50 transition-colors">✕</button>
                      </div>
                    ) : isPrivileged ? (
                      <button onClick={() => setAddingCat(true)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-gray-300 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors">
                        + Add
                      </button>
                    ) : null}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount">
                    <input ref={amountInputRef} type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => set("amount", e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Rate → USD">
                    <input type="number" min="0" step="0.01" value={form.rate} onChange={e => set("rate", e.target.value)} className={inputCls} />
                  </Field>
                </div>
                <Field label="Payment Method">
                  <div className="flex flex-wrap gap-2">
                    {PAYMENTS.map(m => (
                      <button key={m} onClick={() => set("payment", m)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                          ${form.payment === m ? "bg-indigo-600 text-white border-transparent" : "bg-gray-50 text-gray-600 border-gray-200"}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Breakdown</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[["USD base", fmtUsd(usdBase)], ["Fees", fmtUsd(fees)], ["IMT Tax (2%)", fmtUsd(tax)]].map(([l, v]) => (
                      <div key={l} className="bg-white rounded-lg p-2 border border-gray-100">
                        <p className="text-gray-400 mb-0.5">{l}</p>
                        <p className="font-semibold text-gray-700">{v}</p>
                      </div>
                    ))}
                  </div>
                  <div className="w-full rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 flex justify-between items-center">
                    <span className="text-xs font-semibold text-indigo-500">USD Total</span>
                    <span className="text-base font-bold text-indigo-700">{fmtUsd(usdTotal)}</span>
                  </div>
                </div>
                <Field label="Notes">
                  <textarea rows={2} placeholder="Any extra details…" value={form.notes} onChange={e => set("notes", e.target.value)} className={inputCls + " resize-none"} />
                </Field>
                <Field label="Receipt">
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) set("receiptName", e.target.files[0].name); }} />
                  <button onClick={() => fileRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 text-indigo-600 text-sm font-medium py-3 hover:bg-indigo-100 active:scale-95 transition-all">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {form.receiptName || "Upload receipt photo"}
                  </button>
                </Field>
              </div>
            </div>
            {/* Save button */}
            <div className="shrink-0 bg-white border-t border-gray-100 px-4 py-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
              <div className="max-w-xl mx-auto">
                <button onClick={handleSave}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm py-3 rounded-xl transition-all active:scale-95">
                  Save Expense
                </button>
              </div>
            </div>
          </div>

          {/* ── HISTORY slide ────────────────────────────────────── */}
          <div ref={setHistorySlide} style={{ width: `${100 / n}%`, height: "100%", position: "relative", overflow: "hidden" }}>
            <div style={{ height: "100%", overflowY: "auto", touchAction: "pan-y" }}>
              <div className="max-w-xl mx-auto px-4 py-5">
                {loading
                  ? <div className="py-20 text-center text-sm text-gray-400">Loading expenses…</div>
                  : <HistoryView
                      expenses={expenses}
                      merchants={merchants}
                      allCats={allCats}
                      onUpdate={handleUpdate}
                      onDelete={handleDelete}
                      portalTarget={historySlide}
                    />
                }
              </div>
            </div>
          </div>

          {/* ── ADMIN slide ──────────────────────────────────────── */}
          {isPrivileged && (
            <div ref={setAdminSlide} style={{ width: `${100 / n}%`, height: "100%", position: "relative", overflow: "hidden" }}>
              <div style={{ height: "100%", overflowY: "auto", touchAction: "pan-y" }}>
                <div className="max-w-xl mx-auto px-4 py-5">
                  <AdminView portalTarget={adminSlide} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── History view ───────────────────────────────────────────────────────────
function HistoryView({ expenses, merchants, allCats, onUpdate, onDelete, portalTarget }: {
  expenses: Expense[]; merchants: string[]; allCats: CatEntry[];
  onUpdate: (updated: Expense) => void; onDelete: (id: string) => void;
  portalTarget: HTMLDivElement | null;
}) {
  const today = new Date();
  const defaultFrom = firstOfMonth(today.getFullYear(), today.getMonth());
  const defaultTo   = lastOfMonth(today.getFullYear(), today.getMonth());

  const [catFilter, setCatFilter]   = useState<string[]>([]);
  const [pmFilter, setPmFilter]     = useState("");
  const [fromDate, setFromDate]     = useState(defaultFrom);
  const [toDate, setToDate]         = useState(defaultTo);

  // Once expenses load, if current month is empty default to the last month with entries
  const smartDefaultDoneRef = useRef(false);
  useEffect(() => {
    if (smartDefaultDoneRef.current || expenses.length === 0) return;
    smartDefaultDoneRef.current = true;
    const thisMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const hasThisMonth = expenses.some(e => e.date.startsWith(thisMonthKey));
    if (!hasThisMonth) {
      const latest = expenses.reduce((a, b) => a.date > b.date ? a : b);
      const d = new Date(latest.date.slice(0, 10) + "T12:00");
      setFromDate(firstOfMonth(d.getFullYear(), d.getMonth()));
      setToDate(lastOfMonth(d.getFullYear(), d.getMonth()));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses]);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [editing, setEditing]       = useState<Expense | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [displayCount, setDisplayCount] = useState(20);
  const [search, setSearch] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleMonthClick = useCallback((key: string) => {
    if (activeMonth === key) {
      setActiveMonth(null); setFromDate(defaultFrom); setToDate(defaultTo);
    } else {
      setActiveMonth(key);
      const [y, m] = key.split("-").map(Number); // m is 1-indexed from the key
      setFromDate(firstOfMonth(y, m - 1));
      setToDate(lastOfMonth(y, m - 1));
    }
  }, [activeMonth, defaultFrom, defaultTo]);

  const setPreset = useCallback((preset: string) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    setActiveMonth(null);
    if (preset === "this")       { setFromDate(firstOfMonth(y, m));     setToDate(lastOfMonth(y, m)); }
    else if (preset === "last")  { setFromDate(firstOfMonth(y, m - 1)); setToDate(lastOfMonth(y, m - 1)); }
    else if (preset === "3m")    { setFromDate(firstOfMonth(y, m - 2)); setToDate(lastOfMonth(y, m)); }
    else if (preset === "6m")    { setFromDate(firstOfMonth(y, m - 5)); setToDate(lastOfMonth(y, m)); }
    else if (preset === "yr")    { setFromDate(`${y}-01-01`);           setToDate(`${y}-12-31`); }
    else if (preset === "lastyr"){ setFromDate(`${y - 1}-01-01`);      setToDate(`${y - 1}-12-31`); }
    else if (preset === "all")   { setFromDate(""); setToDate(""); }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses.filter(e => {
      if (catFilter.length && !catFilter.includes(e.category)) return false;
      if (pmFilter && e.payment !== pmFilter) return false;
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate + "T23:59") return false;
      if (q && !e.merchant.toLowerCase().includes(q) && !e.notes.toLowerCase().includes(q) && !e.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [expenses, catFilter, pmFilter, fromDate, toDate, search]);

  useEffect(() => { setDisplayCount(20); }, [filtered]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting)
        setDisplayCount(c => Math.min(c + 20, filtered.length));
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered]);

  const filteredNoCat = useMemo(() => expenses.filter(e => {
    if (pmFilter && e.payment !== pmFilter) return false;
    if (fromDate && e.date < fromDate) return false;
    if (toDate && e.date > toDate + "T23:59") return false;
    return true;
  }), [expenses, pmFilter, fromDate, toDate]);

  const totalUsd = filtered.reduce((s, e) => s + e.usdAmount, 0);
  const activeFilters = catFilter.length + (pmFilter ? 1 : 0);

  const exportCSV = () => {
    const headers = ["Date","Time","Merchant","Category","Payment Method","Amount","Rate","USD Base","Fees","IMT Tax","USD Total","Notes"];
    const rows = filtered.map(e => {
      const ub = calcUsdBase(e.amount, e.rate);
      const { fees: fe, tax: tx } = calcFeesAndTax(ub, e.payment);
      return [fmtDate(e.date), fmtTime(e.date), `"${e.merchant}"`, `"${e.category}"`, `"${e.payment}"`,
        e.amount.toFixed(2), e.rate.toFixed(4), ub.toFixed(2), fe.toFixed(2), tx.toFixed(2),
        e.usdAmount.toFixed(2), `"${(e.notes||"").replace(/"/g,'""')}"`];
    });
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `spendlog-${fromDate||"all"}-to-${toDate||"all"}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const editModal = editing && (
    <EditModal expense={editing} merchants={merchants} allCats={allCats}
      onSave={updated => { onUpdate(updated); setEditing(null); }}
      onClose={() => setEditing(null)} />
  );

  return (
    <div className="space-y-4">
      {portalTarget ? createPortal(editModal, portalTarget) : editModal}

      {/* Summary — only total + count */}
      <div className="grid grid-cols-2 gap-3">
        {[["Total Spent", fmtUsd(totalUsd)], ["Transactions", String(filtered.length)]].map(([l, v]) => (
          <div key={l} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">{l}</p>
            <p className="text-base font-semibold text-gray-800 truncate">{v}</p>
          </div>
        ))}
      </div>

      {/* Date Range */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Date Range</p>
        <div className="flex gap-2 mb-3 flex-wrap">
          {([["this","This month"],["last","Last month"],["3m","Last 3 months"],["6m","Last 6 months"],["yr","This year"],["lastyr","Last year"],["all","All time"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setPreset(id)}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-50 border border-gray-200 text-gray-600 active:scale-95 transition-all hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600">
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="text-xs text-gray-400 mb-1">From</p>
            <div className="relative">
              <div className={inputCls + " pointer-events-none"}>
                {fromDate ? fmtDateLabel(fromDate) : "Select date"}
              </div>
              <input type="date" value={fromDate}
                onChange={e => { setFromDate(e.target.value); setActiveMonth(null); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </div>
          </div>
          <span className="text-gray-300 shrink-0 pb-2.5">→</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="text-xs text-gray-400 mb-1">To</p>
            <div className="relative">
              <div className={inputCls + " pointer-events-none"}>
                {toDate ? fmtDateLabel(toDate) : "Select date"}
              </div>
              <input type="date" value={toDate}
                onChange={e => { setToDate(e.target.value); setActiveMonth(null); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </div>
          </div>
        </div>
        {(fromDate || toDate) && (
          <p className="mt-2.5 text-sm font-semibold text-indigo-600">
            {fromDate ? fmtDateLabel(fromDate) : "All time"} → {toDate ? fmtDateLabel(toDate) : "Today"}
          </p>
        )}
      </div>

      {/* Monthly Spend chart */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Monthly Spend — tap a bar to filter</p>
        <StackedChart expenses={expenses} allCats={allCats} onMonthClick={handleMonthClick} activeMonth={activeMonth} fromDate={fromDate} toDate={toDate} />
      </div>

      {/* Category pie */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Spend by Category — tap to filter</p>
        <PieChart expenses={filteredNoCat} allCats={allCats} catFilter={catFilter}
          onCatClick={cat => setCatFilter(prev => prev.length === 1 && prev[0] === cat ? [] : [cat])}
          onClearCats={() => setCatFilter([])} />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button onClick={() => setShowFilters(p => !p)} className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            Filters {activeFilters > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 text-xs">{activeFilters}</span>}
          </span>
          <span className={`text-gray-300 text-xs transition-transform ${showFilters ? "rotate-180" : ""}`}>▼</span>
        </button>
        {showFilters && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-50">
            <div className="flex flex-wrap gap-2 pt-3">
              {allCats.map(c => (
                <button key={c.label} onClick={() => setCatFilter(f => f.includes(c.label) ? f.filter(x => x !== c.label) : [...f, c.label])}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${catFilter.includes(c.label) ? c.tw + " border-transparent" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                  {c.label}
                </button>
              ))}
            </div>
            <select value={pmFilter} onChange={e => setPmFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300">
              <option value="">All payment methods</option>
              {PAYMENTS.map(m => <option key={m}>{m}</option>)}
            </select>
            {activeFilters > 0 && (
              <button onClick={() => { setCatFilter([]); setPmFilter(""); }} className="text-xs text-indigo-500 font-medium">Reset filters</button>
            )}
          </div>
        )}
      </div>

      {/* Export */}
      <button onClick={exportCSV}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 text-sm font-medium py-2.5 active:scale-95 transition-all">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export {filtered.length} record{filtered.length !== 1 ? "s" : ""} as CSV
      </button>

      {/* Expense list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          <div className="flex justify-between items-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Expenses</p>
            <span className="text-xs text-gray-400">{filtered.length} records</span>
          </div>
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search merchant, category, notes…"
              className="w-full pl-8 pr-8 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 placeholder:text-gray-400"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>
        {filtered.length === 0 && <div className="py-10 text-center text-sm text-gray-400">No expenses match your filters.</div>}
        <div className="divide-y divide-gray-50" id="expense-list">
          {filtered.slice(0, displayCount).map(e => {
            const isOpen = expanded === e.id;
            const ub = calcUsdBase(e.amount, e.rate);
            const { fees: fe, tax: tx } = calcFeesAndTax(ub, e.payment);
            return (
              <div key={e.id}>
                <button onClick={() => setExpanded(isOpen ? null : e.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800">{e.merchant}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catTw(e.category, allCats)}`}>{e.category}</span>
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{fmtDate(e.date)} {fmtTime(e.date)}</span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{e.payment}</span>
                    </div>
                    {e.notes && <p className="text-xs text-gray-400 italic mt-0.5 truncate">{e.notes}</p>}
                  </div>
                  <span className="text-sm font-semibold text-gray-800 shrink-0">{fmtUsd(e.usdAmount)}</span>
                  <span className={`text-gray-300 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100 space-y-3">
                    <div className="grid grid-cols-3 gap-2 pt-3">
                      {[["Amount", fmtAmt(e.amount)], ["Rate", fmtAmt(e.rate, 4)], ["USD Base", fmtUsd(ub)]].map(([l, v]) => (
                        <div key={l} className="bg-white rounded-lg p-2 border border-gray-100">
                          <p className="text-xs text-gray-400 mb-0.5">{l}</p>
                          <p className="text-sm font-semibold text-gray-700">{v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[["Fees", fmtUsd(fe)], ["IMT Tax", fmtUsd(tx)], ["USD Total", fmtUsd(e.usdAmount)]].map(([l, v]) => (
                        <div key={l} className={`rounded-lg p-2 border ${l === "USD Total" ? "bg-indigo-50 border-indigo-100" : "bg-white border-gray-100"}`}>
                          <p className={`text-xs mb-0.5 ${l === "USD Total" ? "text-indigo-400" : "text-gray-400"}`}>{l}</p>
                          <p className={`text-sm font-semibold ${l === "USD Total" ? "text-indigo-700" : "text-gray-700"}`}>{v}</p>
                        </div>
                      ))}
                    </div>
                    {e.notes && (
                      <div className="bg-white rounded-lg border border-gray-100 px-3 py-2">
                        <p className="text-xs text-gray-400 mb-0.5">Notes</p>
                        <p className="text-sm text-gray-700 italic">{e.notes}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(e)}
                        className="flex-1 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 text-xs font-medium active:scale-95 transition-all">Edit</button>
                      {confirmDel === e.id ? (
                        <>
                          <button onClick={() => { onDelete(e.id); setExpanded(null); setConfirmDel(null); }}
                            className="flex-1 py-2 rounded-lg bg-red-500 text-white text-xs font-medium active:scale-95 transition-all">Confirm delete</button>
                          <button onClick={() => setConfirmDel(null)}
                            className="flex-1 py-2 rounded-lg bg-gray-200 text-gray-600 text-xs font-medium">Cancel</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDel(e.id)}
                          className="flex-1 py-2 rounded-lg bg-white border border-red-200 text-red-500 text-xs font-medium active:scale-95 transition-all">Delete</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div ref={sentinelRef} />
        {displayCount < filtered.length && (
          <div className="py-4 text-center text-xs text-gray-400">Loading more…</div>
        )}
      </div>
    </div>
  );
}

// ── Edit profile modal ─────────────────────────────────────────────────────
function EditProfileModal({ profile, onSave, onClose, saving, saveError }: {
  profile: Profile;
  onSave: (p: Profile, newEmail: string, newPassword: string) => void;
  onClose: () => void; saving: boolean; saveError: string;
}) {
  const [role, setRole] = useState<Profile["role"]>(profile.role);
  const [email, setEmail] = useState(profile.email);
  const [newPassword, setNewPassword] = useState("");

  const roleOptions: { value: Profile["role"]; label: string }[] = [
    { value: "user", label: "User" },
    { value: "admin", label: "Admin" },
  ];

  return (
    <div className="absolute inset-0 z-50 bg-black/40 flex items-end" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full bg-white rounded-t-2xl" style={{ paddingBottom: "env(safe-area-inset-bottom,16px)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Edit User</h2>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
          </Field>
          <Field label="New Password" sub="(leave blank to keep unchanged)">
            <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputCls} placeholder="••••••••" />
          </Field>
          <Field label="Role">
            <div className="flex gap-2 flex-wrap">
              {roleOptions.map(opt => (
                <button key={opt.value} onClick={() => setRole(opt.value)}
                  className={`px-5 py-2 rounded-lg text-sm font-medium border transition-all ${role === opt.value ? "bg-indigo-600 text-white border-transparent" : "bg-gray-50 text-gray-600 border-gray-200"}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>
          {saveError && <p className="text-xs text-red-600 font-medium">{saveError}</p>}
          <button onClick={() => onSave({ ...profile, role }, email.trim(), newPassword)} disabled={saving}
            className="w-full bg-indigo-600 disabled:opacity-60 text-white font-medium text-sm py-3 rounded-xl active:scale-95 transition-all">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Admin view ─────────────────────────────────────────────────────────────
function AdminView({ portalTarget }: { portalTarget: HTMLDivElement | null }) {
  const [profiles, setProfiles]     = useState<Profile[]>([]);
  const [editing, setEditing]       = useState<Profile | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState("");
  const [loadError, setLoadError]   = useState(false);
  const [showAdd, setShowAdd]       = useState(false);
  const [newEmail, setNewEmail]     = useState("");
  const [newPassword, setNewPassword] = useState(() => randomPassword());
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError]     = useState("");
  const [addedInfo, setAddedInfo]   = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    supabase.from("profiles").select("*").order("email").then(({ data, error }) => {
      if (error) { setLoadError(true); return; }
      if (data) setProfiles(data as Profile[]);
    });
  }, []);

  const reloadProfiles = async () => {
    const { data } = await supabase.from("profiles").select("*").order("email");
    if (data) setProfiles(data as Profile[]);
  };

  const handleSave = async (updated: Profile, newEmail: string, newPassword: string) => {
    setSaving(true); setSaveError("");
    const emailChanged = newEmail && newEmail !== updated.email;

    // Update role (and email) in profiles table
    const profilePatch: Record<string, string> = { role: updated.role };
    if (emailChanged) profilePatch.email = newEmail;
    const { error: profileErr } = await supabase.from("profiles")
      .update(profilePatch).eq("id", updated.id);
    if (profileErr) { setSaveError(profileErr.message); setSaving(false); return; }

    // Update auth email/password via edge function if needed
    if (emailChanged || newPassword) {
      const body: Record<string, string> = { userId: updated.id };
      if (emailChanged) body.email = newEmail;
      if (newPassword) body.password = newPassword;
      const { error: fnErr } = await supabase.functions.invoke("admin-update-user", { body });
      if (fnErr) { setSaveError(fnErr.message); setSaving(false); return; }
    }

    const finalProfile = { ...updated, email: emailChanged ? newEmail : updated.email };
    setProfiles(prev => prev.map(p => p.id === updated.id ? finalProfile : p));
    setEditing(null);
    setSaving(false);
  };

  const handleAddUser = async () => {
    if (!newEmail || !newPassword) { setAddError("Email and password are required."); return; }
    setAddingUser(true); setAddError("");
    const { data, error } = await supabase.auth.signUp({ email: newEmail, password: newPassword });
    if (error) { setAddError(error.message); setAddingUser(false); return; }
    if (data.user) {
      await supabase.from("profiles").upsert({
        id: data.user.id, email: newEmail, role: "user",
      }, { onConflict: "id" });
      await reloadProfiles();
      setAddedInfo({ email: newEmail, password: newPassword });
      setNewEmail(""); setNewPassword(randomPassword());
      setShowAdd(false);
    }
    setAddingUser(false);
  };

  const modal = editing ? (
    <EditProfileModal
      profile={editing}
      onSave={handleSave}
      onClose={() => { setEditing(null); setSaveError(""); }}
      saving={saving}
      saveError={saveError}
    />
  ) : null;

  return (
    <div className="space-y-4">
      {portalTarget ? createPortal(modal, portalTarget) : modal}

      {/* Newly created user credentials */}
      {addedInfo && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-green-700">User created — share these credentials:</p>
          <p className="text-xs text-green-700">Email: <span className="font-mono font-medium">{addedInfo.email}</span></p>
          <p className="text-xs text-green-700">Password: <span className="font-mono font-medium">{addedInfo.password}</span></p>
          <button onClick={() => setAddedInfo(null)} className="text-xs text-green-600 font-medium mt-1">Dismiss</button>
        </div>
      )}

      {/* Add user form */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button onClick={() => { setShowAdd(p => !p); setAddError(""); }}
          className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Add User</span>
          <span className={`text-gray-300 text-xs transition-transform ${showAdd ? "rotate-45" : ""}`}>+</span>
        </button>
        {showAdd && (
          <div className="px-4 pb-4 border-t border-gray-50 space-y-3 pt-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Email</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={inputCls} placeholder="user@example.com" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Temp Password</label>
              <div className="flex gap-2">
                <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputCls} />
                <button onClick={() => setNewPassword(randomPassword())}
                  className="shrink-0 px-3 py-2 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 transition-colors">
                  Regen
                </button>
              </div>
            </div>
            {addError && <p className="text-xs text-red-600 font-medium">{addError}</p>}
            <button onClick={handleAddUser} disabled={addingUser}
              className="w-full bg-indigo-600 disabled:opacity-60 text-white font-medium text-sm py-3 rounded-xl active:scale-95 transition-all">
              {addingUser ? "Creating…" : "Create User"}
            </button>
          </div>
        )}
      </div>

      {/* User list */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Users</p>
          <span className="text-xs text-gray-400">{profiles.length} total</span>
        </div>
        {loadError && <div className="py-10 text-center text-sm text-red-400">Failed to load users.</div>}
        {!loadError && profiles.length === 0 && <div className="py-10 text-center text-sm text-gray-400">No users found.</div>}
        <div className="divide-y divide-gray-50">
          {profiles.map(p => (
            <div key={p.id} className="px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{p.email}</p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
                p.role === "admin" ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
              }`}>
                {p.role === "admin" ? "Admin" : "User"}
              </span>
              <button onClick={() => setEditing(p)} className="text-xs text-indigo-500 font-medium shrink-0 hover:text-indigo-700 transition-colors">Edit</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
