'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const COLORS = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#84cc16','#f97316','#14b8a6'];

interface ChurnPlan { active: number; cancelled: number; rate: number; churned_mrr: number; }
interface KPIData {
  currency: string;
  mrr: number; arr: number; arpu: number; ltv: number;
  churn_rate: number; growth_rate: number; nrr: number;
  active_customers: number; trialing_customers: number;
  past_due_customers: number; total_cancelled: number;
  new_mrr: number; churned_mrr: number; net_mrr: number; new_customers: number;
  mrr_by_plan: Record<string, number>;
  subs_by_plan: Record<string, number>;
  churn_by_plan: Record<string, ChurnPlan>;
  monthly_mrr: { labels: string[]; values: number[] };
  last_updated: string;
}

function fmt(v: number, c = '€') {
  return c + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
}

function KpiCard({ label, value, sub, cls = '' }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-indigo-500/40 transition-colors">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">{label}</p>
      <p className={`text-3xl font-bold tracking-tight mb-1 ${cls}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<KPIData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/kpis');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Chargement des données Stripe…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-950 p-8">
      <div className="max-w-xl mx-auto mt-20 p-4 bg-red-900/30 border border-red-700 rounded-xl text-red-300">
        Erreur : {error}
      </div>
    </div>
  );

  if (!data) return null;
  const c = data.currency;
  const sign = (v: number) => (v >= 0 ? '+' : '') + fmt(v, c);
  const signPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + ' %';

  const mrrLineData = data.monthly_mrr.labels.map((label, i) => ({ label, mrr: data.monthly_mrr.values[i] }));
  const mrrPlanData = Object.entries(data.mrr_by_plan).map(([name, value]) => ({ name, value: Math.round(value) }));
  const subsPlanData = Object.entries(data.subs_by_plan).map(([name, value]) => ({ name, value }));
  const waterfallData = [
    { name: 'Nouveau MRR', value: data.new_mrr, color: '#10b981' },
    { name: 'MRR Perdu',   value: -data.churned_mrr, color: '#ef4444' },
    { name: 'Net MRR',     value: data.net_mrr, color: data.net_mrr >= 0 ? '#6366f1' : '#ef4444' },
  ];
  const planRows = Object.entries(data.mrr_by_plan).sort(([,a],[,b]) => b - a);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-sm">S</div>
          <span className="text-xl font-semibold tracking-tight">SaaS Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            Mis à jour {new Date(data.last_updated).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button onClick={load} className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 rounded-md transition">
            ↻ Actualiser
          </button>
        </div>
      </header>

      <main className="px-8 py-6 space-y-8 max-w-screen-2xl mx-auto">

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Vue d&apos;ensemble</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <KpiCard label="MRR"   value={fmt(data.mrr, c)}  sub="Revenu mensuel récurrent" cls="text-indigo-400" />
            <KpiCard label="ARR"   value={fmt(data.arr, c)}  sub="Revenu annuel récurrent"  cls="text-indigo-300" />
            <KpiCard label="Clients actifs" value={data.active_customers.toLocaleString('fr-FR')} sub={data.trialing_customers ? `+ ${data.trialing_customers} en essai` : 'abonnés payants'} cls="text-emerald-400" />
            <KpiCard label="ARPU"  value={fmt(data.arpu, c)} sub="Revenu moyen / client"    cls="text-sky-400" />
            <KpiCard label="LTV"   value={fmt(data.ltv, c)}  sub="Valeur vie client"         cls="text-violet-400" />
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Mouvements — 30 derniers jours</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <KpiCard label="Nouveau MRR" value={'+' + fmt(data.new_mrr, c)} sub={`${data.new_customers} nouveaux clients`} cls="text-emerald-400" />
            <KpiCard label="MRR Perdu"   value={'-' + fmt(data.churned_mrr, c)} sub="Abonnements résiliés" cls="text-red-400" />
            <KpiCard label="Net MRR"     value={sign(data.net_mrr)} sub="Nouveau − Perdu" cls={data.net_mrr >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            <KpiCard label="Churn Rate"  value={data.churn_rate.toFixed(2) + ' %'} sub="Taux de résiliation / mois" cls="text-red-400" />
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-indigo-500/40 transition-colors">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Croissance MRR</p>
              <p className={`text-3xl font-bold tracking-tight mb-1 ${data.growth_rate >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signPct(data.growth_rate)}</p>
              <p className="text-xs text-gray-500 mb-3">vs. mois précédent</p>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">NRR</p>
              <p className={`text-xl font-bold ${data.nrr >= 100 ? 'text-emerald-400' : 'text-red-400'}`}>{data.nrr.toFixed(1)} %</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Évolution du MRR</p>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={mrrLineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => c + Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v)} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} formatter={(v: number) => [fmt(v, c), 'MRR']} />
                <Line type="monotone" dataKey="mrr" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Abonnements par offre</p>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={subsPlanData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3}>
                  {subsPlanData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">MRR par offre</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={mrrPlanData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => c + Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v)} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={110} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} formatter={(v: number) => [fmt(v, c), 'MRR']} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {mrrPlanData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Mouvements MRR (30j)</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={waterfallData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => c + Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v)} />
                <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} formatter={(v: number) => [fmt(Math.abs(v), c)]} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {waterfallData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Churn par offre</h2>
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/50">
                  {['Offre','Abonnés actifs','Résiliés (30j)','MRR perdu (30j)','Churn rate','MRR'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planRows.map(([plan, mrr], i) => {
                  const cp = data.churn_by_plan[plan] ?? { active: 0, cancelled: 0, rate: 0, churned_mrr: 0 };
                  const churnCls = cp.rate > 5 ? 'text-red-400' : cp.rate > 2 ? 'text-yellow-400' : 'text-emerald-400';
                  return (
                    <tr key={plan} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-4 py-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="font-medium">{plan}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{cp.active.toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-400">{cp.cancelled}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-400">{cp.churned_mrr ? '-' + fmt(cp.churned_mrr, c) : '—'}</td>
                      <td className={`px-4 py-3 text-right font-mono ${churnCls}`}>{cp.rate.toFixed(2)} %</td>
                      <td className="px-4 py-3 text-right font-mono text-indigo-300">{fmt(mrr, c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  );
}
