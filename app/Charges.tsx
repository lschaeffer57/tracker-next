'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ChargeEntry {
  id: string;
  label: string;
  amount: number;
  currency: 'EUR' | 'USD';
  amountEur: number;
}

// Map mois → liste de charges
export type ChargesMap = Record<string, ChargeEntry[]>;

// Totaux par mois (pratique pour les graphiques)
export type MonthTotals = Record<string, number>; // mois → total EUR

const STORAGE_KEY = 'saas_charges_v2';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function loadCharges(): ChargesMap {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); }
  catch { return {}; }
}
function saveCharges(c: ChargesMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}
export function monthTotals(charges: ChargesMap): MonthTotals {
  const out: MonthTotals = {};
  for (const [month, entries] of Object.entries(charges)) {
    out[month] = entries.reduce((s, e) => s + e.amountEur, 0);
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
  months: string[];
  onChange: (charges: ChargesMap) => void;
}

interface DraftEntry {
  id: string | null; // null = nouvelle ligne
  label: string;
  amount: string;
  currency: 'EUR' | 'USD';
}

const EMPTY_DRAFT = (): DraftEntry => ({ id: null, label: '', amount: '', currency: 'EUR' });

export default function Charges({ months, onChange }: Props) {
  const [charges, setCharges]     = useState<ChargesMap>({});
  const [fxRate, setFxRate]       = useState(0.92);
  const [fxDate, setFxDate]       = useState('');
  const [open, setOpen]           = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [draft, setDraft]         = useState<DraftEntry | null>(null);

  useEffect(() => {
    fetch('/api/fx').then(r => r.json()).then(d => {
      setFxRate(d.usd_to_eur ?? 0.92);
      setFxDate(d.date ?? '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const stored = loadCharges();
    setCharges(stored);
    onChange(stored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toEur = useCallback((amount: number, cur: 'EUR' | 'USD') =>
    cur === 'USD' ? Math.round(amount * fxRate * 100) / 100 : amount,
  [fxRate]);

  function update(next: ChargesMap) {
    setCharges(next);
    saveCharges(next);
    onChange(next);
  }

  function startAdd(month: string) {
    setExpandedMonth(month);
    setDraft(EMPTY_DRAFT());
  }

  function startEdit(month: string, entry: ChargeEntry) {
    setExpandedMonth(month);
    setDraft({ id: entry.id, label: entry.label, amount: String(entry.amount), currency: entry.currency });
  }

  function cancelDraft() { setDraft(null); }

  function saveDraft(month: string) {
    if (!draft) return;
    const amount = parseFloat(draft.amount);
    if (isNaN(amount) || amount <= 0) { cancelDraft(); return; }

    const existing = charges[month] ?? [];
    let next: ChargeEntry[];

    const newEntry: ChargeEntry = {
      id: draft.id ?? uid(),
      label: draft.label.trim() || 'Charge',
      amount,
      currency: draft.currency,
      amountEur: toEur(amount, draft.currency),
    };

    if (draft.id) {
      next = existing.map(e => e.id === draft.id ? newEntry : e);
    } else {
      next = [...existing, newEntry];
    }

    update({ ...charges, [month]: next });
    setDraft(EMPTY_DRAFT()); // reste ouvert pour ajouter une autre ligne
  }

  function deleteEntry(month: string, id: string) {
    const next = (charges[month] ?? []).filter(e => e.id !== id);
    const updated = { ...charges };
    if (next.length === 0) delete updated[month];
    else updated[month] = next;
    update(updated);
  }

  const fmt = (v: number) => '€' + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const totals = monthTotals(charges);
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">

      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 bg-gray-900 hover:bg-gray-800/60 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Charges mensuelles</span>
          {grandTotal > 0 && (
            <span className="text-xs bg-red-900/40 text-red-300 border border-red-700/40 px-2 py-0.5 rounded-md">
              Total toutes périodes : {fmt(grandTotal)}
            </span>
          )}
          {fxDate && (
            <span className="text-xs text-gray-600">USD→EUR : {fxRate.toFixed(4)} ({fxDate})</span>
          )}
        </div>
        <span className="text-gray-500 text-sm ml-4">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-gray-950 divide-y divide-gray-800/50">
          {[...months].reverse().map(month => {
            const entries  = charges[month] ?? [];
            const total    = totals[month] ?? 0;
            const isActive = expandedMonth === month;

            return (
              <div key={month}>
                {/* Month row */}
                <div
                  className="flex items-center justify-between px-6 py-3 hover:bg-gray-900/40 cursor-pointer"
                  onClick={() => {
                    if (isActive) { setExpandedMonth(null); setDraft(null); }
                    else { setExpandedMonth(month); setDraft(null); }
                  }}
                >
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm text-gray-400">{month}</span>
                    {entries.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">{entries.length} ligne{entries.length > 1 ? 's' : ''}</span>
                        <span className="text-sm font-semibold text-red-400">{fmt(total)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!isActive && (
                      <button
                        onClick={e => { e.stopPropagation(); startAdd(month); }}
                        className="px-2.5 py-1 text-xs bg-gray-800 hover:bg-indigo-900/50 text-gray-400 hover:text-indigo-300 rounded-lg transition"
                      >
                        + Ajouter
                      </button>
                    )}
                    <span className="text-gray-600 text-xs">{isActive ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded content */}
                {isActive && (
                  <div className="px-6 pb-4 bg-gray-900/20">

                    {/* Existing entries */}
                    {entries.length > 0 && (
                      <div className="mb-3 rounded-xl border border-gray-800 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-900/60 border-b border-gray-800">
                              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Label</th>
                              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">Montant</th>
                              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-500">En EUR</th>
                              <th className="px-3 py-2"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map(entry => (
                              <tr key={entry.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
                                <td className="px-4 py-2.5 text-gray-300">{entry.label}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-gray-400 text-xs">
                                  {entry.currency === 'USD' ? '$' : '€'}{new Intl.NumberFormat('fr-FR').format(entry.amount)} {entry.currency}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-red-400 text-sm">{fmt(entry.amountEur)}</td>
                                <td className="px-3 py-2.5">
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => startEdit(month, entry)}
                                      className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs rounded-md transition"
                                    >✎</button>
                                    <button
                                      onClick={() => deleteEntry(month, entry.id)}
                                      className="px-2 py-1 bg-gray-800 hover:bg-red-900/50 text-gray-400 hover:text-red-400 text-xs rounded-md transition"
                                    >✕</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-gray-900/40">
                              <td className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</td>
                              <td></td>
                              <td className="px-4 py-2 text-right font-bold text-red-300">{fmt(total)}</td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Draft form */}
                    {draft && (
                      <div className="flex items-center gap-2 flex-wrap p-3 bg-gray-900 border border-indigo-800/50 rounded-xl">
                        <input
                          type="text"
                          value={draft.label}
                          onChange={e => setDraft(d => d && ({ ...d, label: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && saveDraft(month)}
                          placeholder="Label (ex: Serveurs, Salaires…)"
                          autoFocus
                          className="flex-1 min-w-40 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
                        />
                        <input
                          type="number"
                          min="0"
                          value={draft.amount}
                          onChange={e => setDraft(d => d && ({ ...d, amount: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && saveDraft(month)}
                          placeholder="Montant"
                          className="w-32 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-right text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
                        />
                        <select
                          value={draft.currency}
                          onChange={e => setDraft(d => d && ({ ...d, currency: e.target.value as 'EUR' | 'USD' }))}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="EUR">€ EUR</option>
                          <option value="USD">$ USD</option>
                        </select>
                        {draft.amount && !isNaN(parseFloat(draft.amount)) && draft.currency === 'USD' && (
                          <span className="text-xs text-gray-500">
                            = {fmt(toEur(parseFloat(draft.amount), 'USD'))}
                          </span>
                        )}
                        <button
                          onClick={() => saveDraft(month)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition font-medium"
                        >
                          {draft.id ? 'Modifier' : 'Ajouter'}
                        </button>
                        <button
                          onClick={cancelDraft}
                          className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded-lg transition"
                        >
                          Annuler
                        </button>
                      </div>
                    )}

                    {/* Add button (when no draft open) */}
                    {!draft && (
                      <button
                        onClick={() => setDraft(EMPTY_DRAFT())}
                        className="mt-2 flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-sm rounded-xl transition w-full justify-center border border-dashed border-gray-700"
                      >
                        <span className="text-lg leading-none">+</span> Ajouter une charge
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
