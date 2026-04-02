'use client';

import { useState, useEffect, useCallback } from 'react';

export interface ChargeEntry {
  amount: number;
  currency: 'EUR' | 'USD';
  amountEur: number; // montant converti en EUR
  label?: string;
}

export type ChargesMap = Record<string, ChargeEntry>;

const STORAGE_KEY = 'saas_charges';

function loadCharges(): ChargesMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveCharges(charges: ChargesMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(charges));
}

interface Props {
  months: string[];                          // liste des mois à afficher (YYYY-MM)
  onChange: (charges: ChargesMap) => void;   // callback quand les charges changent
}

export default function Charges({ months, onChange }: Props) {
  const [charges, setCharges]       = useState<ChargesMap>({});
  const [fxRate, setFxRate]         = useState<number>(0.92);
  const [fxDate, setFxDate]         = useState<string>('');
  const [open, setOpen]             = useState(false);
  const [editMonth, setEditMonth]   = useState<string | null>(null);
  const [inputVal, setInputVal]     = useState('');
  const [inputCur, setInputCur]     = useState<'EUR' | 'USD'>('EUR');
  const [inputLabel, setInputLabel] = useState('');

  // Charger le taux de change
  useEffect(() => {
    fetch('/api/fx')
      .then(r => r.json())
      .then(d => { setFxRate(d.usd_to_eur); setFxDate(d.date ?? ''); })
      .catch(() => {});
  }, []);

  // Charger les charges depuis localStorage
  useEffect(() => {
    const stored = loadCharges();
    setCharges(stored);
    onChange(stored);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const convert = useCallback((amount: number, cur: 'EUR' | 'USD') => {
    return cur === 'USD' ? Math.round(amount * fxRate * 100) / 100 : amount;
  }, [fxRate]);

  function openEdit(month: string) {
    setEditMonth(month);
    const existing = charges[month];
    if (existing) {
      setInputVal(String(existing.amount));
      setInputCur(existing.currency);
      setInputLabel(existing.label ?? '');
    } else {
      setInputVal('');
      setInputCur('EUR');
      setInputLabel('');
    }
  }

  function saveEntry() {
    if (!editMonth) return;
    const amount = parseFloat(inputVal);
    if (isNaN(amount) || amount < 0) { setEditMonth(null); return; }

    const updated = { ...charges };
    if (amount === 0) {
      delete updated[editMonth];
    } else {
      updated[editMonth] = {
        amount,
        currency: inputCur,
        amountEur: convert(amount, inputCur),
        label: inputLabel.trim() || undefined,
      };
    }
    setCharges(updated);
    saveCharges(updated);
    onChange(updated);
    setEditMonth(null);
  }

  function deleteEntry(month: string) {
    const updated = { ...charges };
    delete updated[month];
    setCharges(updated);
    saveCharges(updated);
    onChange(updated);
  }

  const totalEur = Object.values(charges).reduce((s, e) => s + e.amountEur, 0);

  const fmt = (v: number) => '€' + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);

  return (
    <section className="border border-gray-800 rounded-2xl overflow-hidden">

      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 bg-gray-900 hover:bg-gray-800/60 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Charges mensuelles</span>
          {totalEur > 0 && (
            <span className="text-xs bg-red-900/40 text-red-300 border border-red-700/40 px-2 py-0.5 rounded-md">
              Total : {fmt(totalEur)}
            </span>
          )}
          {fxDate && (
            <span className="text-xs text-gray-600">Taux USD/EUR : {fxRate.toFixed(4)} ({fxDate})</span>
          )}
        </div>
        <span className="text-gray-500 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-gray-950 p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left pb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Mois</th>
                  <th className="text-right pb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Charges saisies</th>
                  <th className="text-right pb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">En EUR</th>
                  <th className="text-left pb-3 text-xs font-semibold uppercase tracking-widest text-gray-500 pl-4">Label</th>
                  <th className="pb-3"></th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map(month => {
                  const entry = charges[month];
                  const isEditing = editMonth === month;

                  return (
                    <tr key={month} className="border-b border-gray-800/50 last:border-0">
                      <td className="py-2.5 font-mono text-gray-400 text-xs">{month}</td>

                      {isEditing ? (
                        <>
                          <td className="py-2 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <input
                                type="number"
                                min="0"
                                value={inputVal}
                                onChange={e => setInputVal(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && saveEntry()}
                                autoFocus
                                placeholder="0"
                                className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-right text-sm text-white focus:border-indigo-500 focus:outline-none"
                              />
                              <select
                                value={inputCur}
                                onChange={e => setInputCur(e.target.value as 'EUR' | 'USD')}
                                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                              >
                                <option value="EUR">€ EUR</option>
                                <option value="USD">$ USD</option>
                              </select>
                            </div>
                          </td>
                          <td className="py-2 text-right text-gray-400 text-xs font-mono">
                            {inputVal && !isNaN(parseFloat(inputVal))
                              ? fmt(convert(parseFloat(inputVal), inputCur))
                              : '—'}
                          </td>
                          <td className="py-2 pl-4">
                            <input
                              type="text"
                              value={inputLabel}
                              onChange={e => setInputLabel(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && saveEntry()}
                              placeholder="ex: Serveurs, Salaires…"
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                            />
                          </td>
                          <td className="py-2 pl-3">
                            <div className="flex gap-2">
                              <button onClick={saveEntry}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition">
                                ✓
                              </button>
                              <button onClick={() => setEditMonth(null)}
                                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition">
                                ✕
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2.5 text-right font-mono text-sm">
                            {entry ? (
                              <span className="text-red-300">
                                {entry.currency === 'USD' ? '$' : '€'}{new Intl.NumberFormat('fr-FR').format(entry.amount)} {entry.currency}
                              </span>
                            ) : (
                              <span className="text-gray-700">—</span>
                            )}
                          </td>
                          <td className="py-2.5 text-right font-mono text-sm text-red-400">
                            {entry ? fmt(entry.amountEur) : '—'}
                          </td>
                          <td className="py-2.5 pl-4 text-gray-500 text-xs">{entry?.label ?? ''}</td>
                          <td className="py-2.5 pl-3">
                            <div className="flex gap-1">
                              <button onClick={() => openEdit(month)}
                                className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white text-xs rounded-lg transition">
                                ✎
                              </button>
                              {entry && (
                                <button onClick={() => deleteEntry(month)}
                                  className="px-2.5 py-1 bg-gray-800 hover:bg-red-900/50 text-gray-400 hover:text-red-400 text-xs rounded-lg transition">
                                  ✕
                                </button>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
