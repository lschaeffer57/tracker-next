'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────
interface MonthSnap {
  month: string;
  mrr: number; cash: number; customers: number;
  new_mrr: number; new_customers: number;
  churned_mrr: number; churned_customers: number;
  net_mrr: number; churn_rate: number;
}
interface ChurnPlan { active: number; cancelled: number; rate: number; churned_mrr: number; }
interface KPIData {
  currency: string;
  mrr: number; arr: number; arpu: number; ltv: number;
  churn_rate: number; growth_rate: number; nrr: number;
  active_customers: number; trialing_customers: number;
  past_due_customers: number; total_cancelled: number;
  new_mrr: number; churned_mrr: number; net_mrr: number; new_customers: number;
  scheduled_churn_mrr: number; scheduled_churn_customers: number; healthy_mrr: number;
  cash_this_month: number; cash_total: number;
  mrr_by_plan: Record<string, number>;
  subs_by_plan: Record<string, number>;
  churn_by_plan: Record<string, ChurnPlan>;
  history: MonthSnap[];
  last_updated: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const COLORS = ['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#84cc16','#f97316','#14b8a6'];
const RANGES = [
  { label: 'Tout', months: Infinity },
  { label: '2 ans',  months: 24 },
  { label: '1 an',   months: 12 },
  { label: '6 mois', months: 6  },
  { label: '3 mois', months: 3  },
];

const TOOLTIP_STYLE = {
  contentStyle: { background: '#111827', border: '1px solid #374151', borderRadius: 8 },
  labelStyle: { color: '#f9fafb', fontWeight: 600 },
  itemStyle: { color: '#d1d5db' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v: number, c = '€') {
  return c + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
}
function fmtCompact(v: number, c = '€') {
  return c + Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}
function sign(v: number, c = '€') { return (v >= 0 ? '+' : '') + fmt(v, c); }
function signPct(v: number)        { return (v >= 0 ? '+' : '') + v.toFixed(2) + ' %'; }

// ─── Sub-components ───────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, cls = '' }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-indigo-500/40 transition-colors">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">{label}</p>
      <p className={`text-2xl font-bold tracking-tight mb-1 ${cls}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-5">{title}</p>
      {children}
    </div>
  );
}

function RangeSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {RANGES.map(r => (
        <button
          key={r.label}
          onClick={() => onChange(r.months)}
          className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
            value === r.months
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData]       = useState<KPIData | null>(null);
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(true);
  const [range, setRange]     = useState(Infinity);

  async function load() {
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/kpis');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Filter history by selected range
  const history = useMemo(() => {
    if (!data) return [];
    if (!isFinite(range)) return data.history;
    return data.history.slice(-range);
  }, [data, range]);

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-center">
          <p className="text-gray-200 text-sm font-medium">Chargement des données Stripe…</p>
          <p className="text-gray-500 text-xs mt-1">Récupération de tout l&apos;historique — 20 à 40 secondes</p>
        </div>
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
  const planRows = Object.entries(data.mrr_by_plan).sort(([,a],[,b]) => b - a);
  const mrrPlanData  = planRows.map(([name, value]) => ({ name, value: Math.round(value) }));
  const subsPlanData = Object.entries(data.subs_by_plan).map(([name, value]) => ({ name, value }));

  // Waterfall data
  const waterfallData = [
    { name: 'Nouveau MRR', value: data.new_mrr,     color: '#10b981' },
    { name: 'MRR Perdu',   value: -data.churned_mrr, color: '#ef4444' },
    { name: 'Net MRR',     value: data.net_mrr,      color: data.net_mrr >= 0 ? '#6366f1' : '#ef4444' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* Header */}
      <header className="border-b border-gray-800 px-8 py-4 flex items-center justify-between sticky top-0 bg-gray-950/80 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-sm">S</div>
          <span className="text-xl font-semibold tracking-tight">SaaS Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            {new Date(data.last_updated).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button onClick={load} className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 rounded-md transition">
            ↻ Actualiser
          </button>
        </div>
      </header>

      <main className="px-8 py-6 space-y-8 max-w-screen-2xl mx-auto">

        {/* ── KPI Cards ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Vue d&apos;ensemble</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
            <KpiCard label="MRR"            value={fmt(data.mrr, c)}             sub="Revenu mensuel récurrent"      cls="text-indigo-400" />
            <KpiCard label="ARR"            value={fmt(data.arr, c)}             sub="Revenu annuel récurrent"       cls="text-indigo-300" />
            <KpiCard label="MRR sain"       value={fmt(data.healthy_mrr, c)}     sub="Hors résiliations programmées" cls="text-emerald-400" />
            <KpiCard label="Cash ce mois"   value={fmt(data.cash_this_month, c)} sub="Factures payées ce mois"       cls="text-teal-400" />
            <KpiCard label="Clients actifs" value={data.active_customers.toLocaleString('fr-FR')} sub={data.trialing_customers ? `+ ${data.trialing_customers} en essai` : 'abonnés payants'} cls="text-emerald-400" />
            <KpiCard label="ARPU"           value={fmt(data.arpu, c)}            sub="Revenu moyen / client"         cls="text-sky-400" />
            <KpiCard label="LTV"            value={fmt(data.ltv, c)}             sub="Valeur vie client"              cls="text-violet-400" />
          </div>
          {data.scheduled_churn_customers > 0 && (
            <div className="mt-4 flex items-center gap-3 px-4 py-3 bg-orange-900/20 border border-orange-700/40 rounded-xl">
              <span className="text-orange-400 text-lg">⚠</span>
              <div>
                <span className="text-orange-300 font-semibold text-sm">{fmt(data.scheduled_churn_mrr, c)} de MRR</span>
                <span className="text-orange-400/80 text-sm"> en cours de résiliation </span>
                <span className="text-orange-400/60 text-xs">({data.scheduled_churn_customers} client{data.scheduled_churn_customers > 1 ? 's' : ''} avec cancel_at_period_end — encore actifs jusqu&apos;à fin de période)</span>
              </div>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Mouvements — 30 derniers jours</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">
            <KpiCard label="Nouveau MRR" value={'+' + fmt(data.new_mrr, c)} sub={`${data.new_customers} nouveaux clients`} cls="text-emerald-400" />
            <KpiCard label="MRR Perdu"   value={'-' + fmt(data.churned_mrr, c)} sub="Abonnements résiliés" cls="text-red-400" />
            <KpiCard label="Net MRR"     value={sign(data.net_mrr, c)} sub="Nouveau − Perdu" cls={data.net_mrr >= 0 ? 'text-emerald-400' : 'text-red-400'} />
            <KpiCard label="Churn Rate"  value={data.churn_rate.toFixed(2) + ' %'} sub="Taux de résiliation / mois" cls="text-red-400" />
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-indigo-500/40 transition-colors">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">Croissance MRR</p>
              <p className={`text-2xl font-bold mb-1 ${data.growth_rate >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{signPct(data.growth_rate)}</p>
              <p className="text-xs text-gray-500 mb-3">vs. mois précédent</p>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">NRR</p>
              <p className={`text-xl font-bold ${data.nrr >= 100 ? 'text-emerald-400' : 'text-red-400'}`}>{data.nrr.toFixed(1)} %</p>
            </div>
          </div>
        </section>

        {/* ── Range selector ── */}
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500">Historique</h2>
          <RangeSelector value={range} onChange={setRange} />
        </div>

        {/* ── MRR vs Cash Evolution ── */}
        <ChartCard title="MRR vs Cash collecté">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#14b8a6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => fmtCompact(v, c)} width={70} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [fmt(v, c)]} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              <Area type="monotone" dataKey="mrr"  stroke="#6366f1" strokeWidth={2.5}
                fill="url(#mrrGrad)"  dot={false} activeDot={{ r: 5 }} name="MRR (récurrent)" />
              <Area type="monotone" dataKey="cash" stroke="#14b8a6" strokeWidth={2}
                fill="url(#cashGrad)" dot={false} activeDot={{ r: 5 }} name="Cash collecté" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ── Mouvements MRR & Clients en 2 colonnes ── */}
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">

          {/* Mouvements MRR mensuels */}
          <ChartCard title="Mouvements MRR mensuels (nouveau vs perdu)">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => fmtCompact(v, c)} width={70} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [fmt(Math.abs(v), c)]} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <ReferenceLine y={0} stroke="#374151" />
                <Bar dataKey="new_mrr"     name="Nouveau MRR" fill="#10b981" radius={[3,3,0,0]} />
                <Bar dataKey="churned_mrr" name="MRR Perdu"   fill="#ef4444" radius={[3,3,0,0]}
                  // flip to negative for visual clarity
                />
                <Line type="monotone" dataKey="net_mrr" name="Net MRR" stroke="#f59e0b"
                  strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Évolution clients */}
          <ChartCard title="Évolution du nombre de clients">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={history}>
                <defs>
                  <linearGradient id="custGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="left"  tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                <Area yAxisId="left" type="monotone" dataKey="customers" name="Clients actifs"
                  stroke="#10b981" strokeWidth={2} fill="url(#custGrad)" dot={false} />
                <Bar  yAxisId="right" dataKey="new_customers"     name="Nouveaux" fill="#6366f1" radius={[3,3,0,0]} />
                <Bar  yAxisId="right" dataKey="churned_customers" name="Résiliés" fill="#ef4444" radius={[3,3,0,0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

        </section>

        {/* ── Churn rate historique ── */}
        <ChartCard title="Taux de churn mensuel (%)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => v + ' %'} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(2) + ' %', 'Churn']} />
              <Bar dataKey="churn_rate" name="Churn rate" radius={[3,3,0,0]}>
                {history.map((entry, i) => (
                  <Cell key={i} fill={entry.churn_rate > 10 ? '#ef4444' : entry.churn_rate > 5 ? '#f59e0b' : '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* ── Par offre (snapshot actuel) ── */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <ChartCard title="MRR par offre (actuel)">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={mrrPlanData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => fmtCompact(v, c)} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={120} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [fmt(v, c), 'MRR']} />
                <Bar dataKey="value" radius={[0,6,6,0]}>
                  {mrrPlanData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Abonnements par offre">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={subsPlanData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={65} outerRadius={95} paddingAngle={3}>
                  {subsPlanData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Mouvements MRR (30j)">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={waterfallData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => fmtCompact(Math.abs(v), c)} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [fmt(Math.abs(v), c)]} />
                <Bar dataKey="value" radius={[6,6,0,0]}>
                  {waterfallData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>

        {/* ── Churn table ── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-4">Churn par offre (30j)</h2>
          <div className="overflow-x-auto rounded-2xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/50">
                  {['Offre','Abonnés actifs','Résiliés (30j)','MRR perdu (30j)','Churn rate','MRR actuel'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planRows.map(([plan, mrr], i) => {
                  const cp = data.churn_by_plan[plan] ?? { active: 0, cancelled: 0, rate: 0, churned_mrr: 0 };
                  const churnCls = cp.rate > 10 ? 'text-red-400' : cp.rate > 5 ? 'text-yellow-400' : 'text-emerald-400';
                  return (
                    <tr key={plan} className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="font-medium">{plan}</span>
                        </div>
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
