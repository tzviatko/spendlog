import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { supabase, type ExpenseRow } from "./lib/supabase";

// ── Types ──────────────────────────────────────────────────────────────────
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

// ── Constants ──────────────────────────────────────────────────────────────
const CAT = [
  { label: "Food & Groceries", tw: "bg-emerald-100 text-emerald-800", hex: "#6ee7b7" },
  { label: "Transport", tw: "bg-sky-100 text-sky-800", hex: "#7dd3fc" },
  { label: "Utilities", tw: "bg-violet-100 text-violet-800", hex: "#c4b5fd" },
  { label: "Health", tw: "bg-rose-100 text-rose-800", hex: "#fda4af" },
  { label: "Entertainment", tw: "bg-amber-100 text-amber-800", hex: "#fcd34d" },
  { label: "Clothing", tw: "bg-pink-100 text-pink-800", hex: "#f9a8d4" },
  { label: "Home & Construction", tw: "bg-orange-100 text-orange-800", hex: "#fdba74" },
  { label: "Travel", tw: "bg-cyan-100 text-cyan-800", hex: "#67e8f9" },
  { label: "Business", tw: "bg-indigo-100 text-indigo-800", hex: "#a5b4fc" },
  { label: "Other", tw: "bg-gray-100 text-gray-600", hex: "#d1d5db" },
];
const PAYMENTS = ["Cash", "Card ZIM", "Card USA", "EcoCash", "Transfer external", "Transfer internal internet", "Transfer internal mobile"];

const catTw = (l: string) => CAT.find(c => c.label === l)?.tw ?? "bg-gray-100 text-gray-600";
const catHex = (l: string) => CAT.find(c => c.label === l)?.hex ?? "#d1d5db";

// ── Helpers ────────────────────────────────────────────────────────────────
const nowZW = () => {
  const now = new Date();
  const zw = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return zw.toISOString().slice(0, 16);
};

const calcFeesAndTax = (amountUsd: number, payment: string) => {
  let fees = 0;
  let tax = 0;
  const amt = amountUsd || 0;
  if (payment === "Card ZIM") {
    fees = Math.max(amt * 0.0165, 1.50) + 0.20 + amt * 0.006;
    tax = amt * 0.02;
  } else if (payment === "EcoCash") {
    fees = amt * 0.013;
    tax = amt > 5 ? amt * 0.02 : 0;
  } else if (payment === "Transfer external") {
    fees = 3; tax = amt * 0.02;
  } else if (payment === "Transfer internal internet") {
    fees = 1; tax = amt * 0.02;
  } else if (payment === "Transfer internal mobile") {
    fees = 2; tax = amt * 0.02;
  }
  return { fees: parseFloat(fees.toFixed(2)), tax: parseFloat(tax.toFixed(2)) };
};

const calcUsdBase = (amount: string | number, rate: string | number) =>
  parseFloat(((parseFloat(String(amount)) || 0) / (parseFloat(String(rate)) || 1)).toFixed(2));
const calcTotal = (usdBase: number, fees: number, tax: number) =>
  parseFloat((usdBase + fees + tax).toFixed(2));

const fmtUsd = (n: number) => "$" + (n || 0).toFixed(2);
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const rowToExpense = (row: ExpenseRow): Expense => ({
  id: row.id,
  date: row.date,
  merchant: row.merchant,
  category: row.category,
  amount: Number(row.amount),
  rate: Number(row.rate),
  payment: row.payment,
  notes: row.notes || "",
  usdAmount: Number(row.usd_amount),
});

// ── Shared styles ──────────────────────────────────────────────────────────
const inputCls = "w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300";
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
function StackedChart({ expenses, onMonthClick, activeMonth }: {
  expenses: Expense[];
  onMonthClick: (key: string) => void;
  activeMonth: string | null;
}) {
  const months = useMemo(() => {
    const out = [];
    for (let i = 3; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const label = d.toLocaleString("default", { month: "short" });
      const entries = expenses.filter(e => e.date.startsWith(key));
      const byCat: Record<string, number> = {};
      entries.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.usdAmount; });
      const total = Object.values(byCat).reduce((s, v) => s + v, 0);
      out.push({ key, label, byCat, total: parseFloat(total.toFixed(2)) });
    }
    return out;
  }, [expenses]);

  const max = Math.max(...months.map(m => m.total), 1);

  return (
    <div>
      <div className="flex items-end gap-3" style={{ height: 120 }}>
        {months.map(m => {
          const isActive = activeMonth === m.key;
          const barH = Math.max((m.total / max) * 100, m.total > 0 ? 4 : 0);
          const segs = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]);
          return (
            <button key={m.key} onClick={() => onMonthClick(m.key)}
              className="flex-1 flex flex-col items-center gap-1 focus:outline-none group"
              style={{ height: "100%" }}>
              <span className="text-xs text-gray-400 mb-1" style={{ fontSize: 10 }}>
                {m.total > 0 ? fmtUsd(m.total) : ""}
              </span>
              <div className="w-full flex flex-col justify-end rounded-t-md overflow-hidden"
                style={{ height: "75%", border: isActive ? "2px solid #4f46e5" : "2px solid transparent", borderRadius: 6 }}>
                {m.total === 0
                  ? <div className="w-full bg-gray-100 rounded-t-md" style={{ height: "8%" }} />
                  : segs.map(([cat, val]) => (
                    <div key={cat} style={{ height: `${(val / m.total) * barH}%`, background: catHex(cat), minHeight: 2 }} />
                  ))}
              </div>
              <span className={`text-xs font-medium mt-1 ${isActive ? "text-indigo-600" : "text-gray-400"}`} style={{ fontSize: 11 }}>{m.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">
        {CAT.filter(c => expenses.some(e => e.category === c.label)).map(c => (
          <span key={c.label} className="flex items-center gap-1 text-xs text-gray-500" style={{ fontSize: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.hex, display: "inline-block" }} />
            {c.label}
          </span>
        ))}
      </div>
      {activeMonth && (
        <button onClick={() => onMonthClick(activeMonth)} className="mt-2 text-xs text-indigo-500 font-medium">
          Clear month filter
        </button>
      )}
    </div>
  );
}

// ── Edit modal ─────────────────────────────────────────────────────────────
function EditModal({ expense, merchants, onSave, onClose }: {
  expense: Expense;
  merchants: string[];
  onSave: (updated: Expense) => void;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    date: expense.date, merchant: expense.merchant, merchantInput: "",
    category: expense.category, amount: String(expense.amount),
    rate: String(expense.rate), payment: expense.payment, notes: expense.notes || "",
  });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const usdBase = calcUsdBase(f.amount, f.rate);
  const { fees, tax } = calcFeesAndTax(usdBase, f.payment);
  const usdTotal = calcTotal(usdBase, fees, tax);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full bg-white rounded-t-2xl max-h-screen overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom,16px)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Edit Expense</h2>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="Date & Time">
            <input type="datetime-local" value={f.date} onChange={e => set("date", e.target.value)} className={inputCls} />
          </Field>
          <Field label="Merchant">
            <div className="flex gap-2">
              <select value={f.merchant} onChange={e => { set("merchant", e.target.value); set("merchantInput", ""); }} className={inputCls}>
                {merchants.map(m => <option key={m}>{m}</option>)}
              </select>
              <input placeholder="Or type new…" value={f.merchantInput} onChange={e => { set("merchantInput", e.target.value); set("merchant", ""); }} className={inputCls} />
            </div>
          </Field>
          <Field label="Category">
            <div className="flex flex-wrap gap-2">
              {CAT.map(c => (
                <button key={c.label} onClick={() => set("category", c.label)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${f.category === c.label ? c.tw + " border-transparent ring-2 ring-indigo-300" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (local)">
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
            <Field label="USD Base"><div className={readonlyCls + " text-gray-400"}>{usdBase.toFixed(2)}</div></Field>
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
            const merchant = f.merchantInput || f.merchant;
            if (!merchant || !(parseFloat(f.amount) > 0)) return;
            const usdBase2 = calcUsdBase(f.amount, f.rate);
            const { fees: fe, tax: tx } = calcFeesAndTax(usdBase2, f.payment);
            onSave({ ...expense, date: f.date, merchant, category: f.category, amount: parseFloat(f.amount), rate: parseFloat(f.rate) || 1, payment: f.payment, notes: f.notes, usdAmount: calcTotal(usdBase2, fe, tx) });
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
  const [view, setView] = useState("entry");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [form, setForm] = useState({
    date: nowZW(), merchant: "", merchantInput: "",
    category: "Food & Groceries", amount: "", rate: "1.00",
    payment: "Cash", notes: "", receiptName: "",
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const merchants = useMemo(() => [...new Set(expenses.map(e => e.merchant))].sort(), [expenses]);

  useEffect(() => {
    supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setExpenses((data as ExpenseRow[]).map(rowToExpense));
        setLoading(false);
      });
  }, []);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const usdBase = calcUsdBase(form.amount, form.rate);
  const { fees, tax } = calcFeesAndTax(usdBase, form.payment);
  const usdTotal = calcTotal(usdBase, fees, tax);

  const handleSave = async () => {
    const merchant = form.merchantInput || form.merchant;
    if (!merchant) { showToast("Merchant required", "error"); return; }
    if (!(parseFloat(form.amount) > 0)) { showToast("Amount must be > 0", "error"); return; }

    const ub = calcUsdBase(form.amount, form.rate);
    const { fees: fe, tax: tx } = calcFeesAndTax(ub, form.payment);
    const usdAmount = calcTotal(ub, fe, tx);

    const { data, error } = await supabase
      .from("expenses")
      .insert({
        date: form.date,
        merchant,
        category: form.category,
        amount: parseFloat(form.amount),
        rate: parseFloat(form.rate) || 1,
        payment: form.payment,
        notes: form.notes,
        usd_amount: usdAmount,
      })
      .select()
      .single();

    if (error) { showToast("Failed to save", "error"); return; }

    setExpenses(p => [rowToExpense(data as ExpenseRow), ...p]);
    setForm(f => ({ date: nowZW(), merchant: "", merchantInput: "", category: "Food & Groceries", amount: "", rate: "1.00", payment: f.payment, notes: "", receiptName: "" }));
    showToast("Expense saved!");
  };

  const handleUpdate = async (updated: Expense) => {
    const { error } = await supabase
      .from("expenses")
      .update({
        date: updated.date,
        merchant: updated.merchant,
        category: updated.category,
        amount: updated.amount,
        rate: updated.rate,
        payment: updated.payment,
        notes: updated.notes,
        usd_amount: updated.usdAmount,
      })
      .eq("id", updated.id);

    if (error) { showToast("Failed to update", "error"); return; }
    setExpenses(p => p.map(e => e.id === updated.id ? updated : e));
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) { showToast("Failed to delete", "error"); return; }
    setExpenses(p => p.filter(e => e.id !== id));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-md
          ${toast.type === "error" ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
          {toast.msg}
        </div>
      )}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-xl mx-auto px-4 flex items-center justify-between h-14">
          <span className="text-indigo-600 font-semibold">Spendlog</span>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {[["entry", "Add"], ["dashboard", "History"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${view === v ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>
      <div className="max-w-xl mx-auto px-4 py-5">
        {view === "entry" ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">New Expense</p>
            <Field label="Date & Time" sub="(Zimbabwe time)">
              <input type="datetime-local" value={form.date} onChange={e => set("date", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Merchant">
              <div className="flex gap-2">
                <select value={form.merchant} onChange={e => { set("merchant", e.target.value); set("merchantInput", ""); }} className={inputCls}>
                  <option value="">— select —</option>
                  {merchants.map(m => <option key={m}>{m}</option>)}
                </select>
                <input placeholder="Or type new…" value={form.merchantInput} onChange={e => { set("merchantInput", e.target.value); set("merchant", ""); }} className={inputCls} />
              </div>
            </Field>
            <Field label="Category">
              <div className="flex flex-wrap gap-2">
                {CAT.map(c => (
                  <button key={c.label} onClick={() => set("category", c.label)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all
                      ${form.category === c.label ? c.tw + " border-transparent ring-2 ring-indigo-300" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (local)">
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => set("amount", e.target.value)} className={inputCls} />
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
                <div className="bg-white rounded-lg p-2 border border-gray-100">
                  <p className="text-gray-400 mb-0.5">USD base</p>
                  <p className="font-semibold text-gray-700">{fmtUsd(usdBase)}</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-gray-100">
                  <p className="text-gray-400 mb-0.5">Fees</p>
                  <p className="font-semibold text-gray-700">{fmtUsd(fees)}</p>
                </div>
                <div className="bg-white rounded-lg p-2 border border-gray-100">
                  <p className="text-gray-400 mb-0.5">IMT Tax (2%)</p>
                  <p className="font-semibold text-gray-700">{fmtUsd(tax)}</p>
                </div>
              </div>
              <div className="w-full rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 flex justify-between items-center">
                <span className="text-xs font-semibold text-indigo-500">USD Total</span>
                <span className="text-base font-bold text-indigo-700">{fmtUsd(usdTotal)}</span>
              </div>
            </div>
            <Field label="Notes (optional)">
              <textarea rows={2} placeholder="Any extra details…" value={form.notes} onChange={e => set("notes", e.target.value)} className={inputCls + " resize-none"} />
            </Field>
            <Field label="Receipt (optional)">
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => { if (e.target.files?.[0]) set("receiptName", e.target.files[0].name); }} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-indigo-50 text-indigo-600 text-sm font-medium py-3 hover:bg-indigo-100 active:scale-95 transition-all">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {form.receiptName ? form.receiptName : "Upload receipt photo"}
              </button>
            </Field>
            <button onClick={handleSave} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm py-3 rounded-xl transition-all active:scale-95">
              Save Expense
            </button>
          </div>
        ) : loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading expenses…</div>
        ) : (
          <HistoryView
            expenses={expenses}
            merchants={merchants}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

// ── History view ───────────────────────────────────────────────────────────
function HistoryView({ expenses, merchants, onUpdate, onDelete }: {
  expenses: Expense[];
  merchants: string[];
  onUpdate: (updated: Expense) => void;
  onDelete: (id: string) => void;
}) {
  const currentMonthStart = new Date(); currentMonthStart.setDate(1);
  const defaultFrom = currentMonthStart.toISOString().slice(0, 10);
  const defaultTo = new Date().toISOString().slice(0, 10);

  const [catFilter, setCatFilter] = useState<string[]>([]);
  const [pmFilter, setPmFilter] = useState("");
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);

  const handleMonthClick = useCallback((key: string) => {
    if (activeMonth === key) {
      setActiveMonth(null);
      setFromDate(defaultFrom);
      setToDate(defaultTo);
    } else {
      setActiveMonth(key);
      const [y, m] = key.split("-").map(Number);
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0);
      setFromDate(first.toISOString().slice(0, 10));
      setToDate(last.toISOString().slice(0, 10));
    }
  }, [activeMonth, defaultFrom, defaultTo]);

  const filtered = useMemo(() => expenses.filter(e => {
    if (catFilter.length && !catFilter.includes(e.category)) return false;
    if (pmFilter && e.payment !== pmFilter) return false;
    if (fromDate && e.date < fromDate) return false;
    if (toDate && e.date > toDate + "T23:59") return false;
    return true;
  }), [expenses, catFilter, pmFilter, fromDate, toDate]);

  const totalUsd = filtered.reduce((s, e) => s + e.usdAmount, 0);
  const topCat = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(e => { m[e.category] = (m[e.category] || 0) + e.usdAmount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  }, [filtered]);
  const topMerchant = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(e => { m[e.merchant] = (m[e.merchant] || 0) + e.usdAmount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  }, [filtered]);

  const activeFilters = catFilter.length + (pmFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0);

  const exportCSV = () => {
    const headers = ["Date", "Time", "Merchant", "Category", "Payment Method", "Amount (local)", "Rate", "USD Total", "Notes"];
    const rows = filtered.map(e => [
      fmtDate(e.date), fmtTime(e.date), `"${e.merchant}"`, `"${e.category}"`, `"${e.payment}"`,
      e.amount.toFixed(2), e.rate.toFixed(4), e.usdAmount.toFixed(2), `"${(e.notes || "").replace(/"/g, '""')}"`
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `spendlog-${fromDate || "all"}-to-${toDate || "all"}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {editing && (
        <EditModal expense={editing} merchants={merchants}
          onSave={updated => { onUpdate(updated); setEditing(null); }}
          onClose={() => setEditing(null)} />
      )}
      <div className="grid grid-cols-2 gap-3">
        {[["Total Spent", fmtUsd(totalUsd)], ["Transactions", String(filtered.length)], ["Top Category", topCat], ["Top Merchant", topMerchant]].map(([l, v]) => (
          <div key={l} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">{l}</p>
            <p className="text-base font-semibold text-gray-800 truncate">{v}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Monthly Spend — tap a bar to filter</p>
        <StackedChart expenses={expenses} onMonthClick={handleMonthClick} activeMonth={activeMonth} />
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <button onClick={() => setShowFilters(p => !p)}
          className="w-full flex items-center justify-between px-4 py-3 text-left">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            Filters {activeFilters > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 text-xs">{activeFilters}</span>}
          </span>
          <span className={`text-gray-300 text-xs transition-transform ${showFilters ? "rotate-180" : ""}`}>▼</span>
        </button>
        {showFilters && (
          <div className="px-4 pb-4 space-y-3 border-t border-gray-50">
            <div className="flex flex-wrap gap-2 pt-3">
              {CAT.map(c => (
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
            <div className="flex gap-2 items-center">
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <span className="text-gray-400">→</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            {activeFilters > 0 && (
              <button onClick={() => { setCatFilter([]); setPmFilter(""); setFromDate(defaultFrom); setToDate(defaultTo); setActiveMonth(null); }} className="text-xs text-indigo-500 font-medium">Reset filters</button>
            )}
          </div>
        )}
      </div>
      <button onClick={exportCSV}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 text-sm font-medium py-2.5 active:scale-95 transition-all">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Export {filtered.length} record{filtered.length !== 1 ? "s" : ""} as CSV
      </button>
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Expenses</p>
          <span className="text-xs text-gray-400">{filtered.length} records</span>
        </div>
        {filtered.length === 0 && <div className="py-10 text-center text-sm text-gray-400">No expenses match your filters.</div>}
        <div className="divide-y divide-gray-50">
          {filtered.map(e => {
            const isOpen = expanded === e.id;
            return (
              <div key={e.id}>
                <button onClick={() => setExpanded(isOpen ? null : e.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-800">{e.merchant}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catTw(e.category)}`}>{e.category}</span>
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{fmtDate(e.date)} {fmtTime(e.date)}</span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{e.payment}</span>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-gray-800 shrink-0">{fmtUsd(e.usdAmount)}</span>
                  <span className={`text-gray-300 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▼</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 bg-gray-50 border-t border-gray-100 space-y-3">
                    <div className="grid grid-cols-3 gap-2 pt-3">
                      {[["Local", e.amount.toFixed(2)], ["Rate", e.rate.toFixed(4)], ["USD Total", fmtUsd(e.usdAmount)]].map(([l, v]) => (
                        <div key={l} className="bg-white rounded-lg p-2 border border-gray-100">
                          <p className="text-xs text-gray-400 mb-0.5">{l}</p>
                          <p className="text-sm font-semibold text-gray-700">{v}</p>
                        </div>
                      ))}
                    </div>
                    {e.notes && <p className="text-xs text-gray-500 italic">"{e.notes}"</p>}
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(e)}
                        className="flex-1 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600 text-xs font-medium active:scale-95 transition-all">
                        Edit
                      </button>
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
      </div>
    </div>
  );
}
