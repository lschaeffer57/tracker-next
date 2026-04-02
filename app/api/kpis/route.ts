import Stripe from 'stripe';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

let _stripe: Stripe | null = null;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}
const stripe = {
  get products()      { return getStripe().products; },
  get subscriptions() { return getStripe().subscriptions; },
  get invoices()      { return getStripe().invoices; },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getItems(sub: Stripe.Subscription) {
  return sub.items?.data ?? [];
}

function monthlyAmountCents(sub: Stripe.Subscription): number {
  let total = 0;
  for (const item of getItems(sub)) {
    const price = item.price;
    if (!price?.unit_amount || !price?.recurring) continue;
    const qty = item.quantity ?? 1;
    let amt = price.unit_amount * qty;
    const interval = price.recurring.interval;
    if (interval === 'year')  amt = amt / 12;
    if (interval === 'week')  amt = amt * 52 / 12;
    if (interval === 'day')   amt = amt * 365 / 12;
    total += amt;
  }
  return total;
}

function planName(sub: Stripe.Subscription, products: Map<string, Stripe.Product>): string {
  const names: string[] = [];
  for (const item of getItems(sub)) {
    const price = item.price;
    const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;
    const prod = productId ? products.get(productId) : null;
    names.push(prod?.name ?? price?.nickname ?? price?.id ?? 'Inconnu');
  }
  return names.join(' + ') || 'Inconnu';
}

function r2(n: number) { return Math.round(n * 100) / 100; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T>(fn: (params: any) => Promise<Stripe.ApiList<T>>, params: Record<string, unknown> = {}): Promise<T[]> {
  const items: T[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any = { limit: 100, ...params };
  while (true) {
    const resp = await fn(p);
    items.push(...resp.data);
    if (!resp.has_more) break;
    p = { ...p, starting_after: (items[items.length - 1] as { id: string }).id };
  }
  return items;
}

// ─── MRR history reconstruction ───────────────────────────────────────────────
// Reconstitue le vrai MRR mois par mois depuis le premier abonnement.
// Pour chaque mois, on calcule :
//   - MRR  : abos actifs à la fin du mois
//   - new MRR  : abos créés dans ce mois
//   - churned MRR : abos annulés dans ce mois
//   - customers : nb d'abos actifs à la fin du mois

interface MonthSnap {
  month: string;       // "YYYY-MM"
  mrr: number;
  customers: number;
  new_mrr: number;
  new_customers: number;
  churned_mrr: number;
  churned_customers: number;
  net_mrr: number;
  churn_rate: number;
}

function reconstructHistory(allSubs: Stripe.Subscription[]): MonthSnap[] {
  if (!allSubs.length) return [];

  // Earliest subscription start
  const earliest = Math.min(...allSubs.map(s => s.created));
  const startDate = new Date(earliest * 1000);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const now = new Date();
  const snaps: MonthSnap[] = [];

  let cursor = new Date(startDate);
  while (cursor <= now) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const monthStart = new Date(y, m, 1).getTime();
    const monthEnd   = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime();
    const monthKey   = `${y}-${String(m + 1).padStart(2, '0')}`;

    let mrr = 0, customers = 0;
    let newMrr = 0, newCustomers = 0;
    let churnedMrr = 0, churnedCustomers = 0;

    for (const sub of allSubs) {
      const subStart = sub.created * 1000;
      const subEnd   = sub.canceled_at ? sub.canceled_at * 1000 : Infinity;
      const amt      = monthlyAmountCents(sub) / 100;

      // Active at end of month
      if (subStart <= monthEnd && subEnd > monthEnd) {
        mrr += amt;
        customers++;
      }
      // New this month
      if (subStart >= monthStart && subStart <= monthEnd) {
        newMrr += amt;
        newCustomers++;
      }
      // Churned this month
      if (sub.canceled_at) {
        const ca = sub.canceled_at * 1000;
        if (ca >= monthStart && ca <= monthEnd) {
          churnedMrr += amt;
          churnedCustomers++;
        }
      }
    }

    const churnRate = (customers + churnedCustomers) > 0
      ? r2(churnedCustomers / (customers + churnedCustomers) * 100)
      : 0;

    snaps.push({
      month: monthKey,
      mrr: r2(mrr),
      customers,
      new_mrr: r2(newMrr),
      new_customers: newCustomers,
      churned_mrr: r2(churnedMrr),
      churned_customers: churnedCustomers,
      net_mrr: r2(newMrr - churnedMrr),
      churn_rate: churnRate,
    });

    cursor = new Date(y, m + 1, 1);
  }

  return snaps;
}

// ─── Cache ────────────────────────────────────────────────────────────────────
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 300_000; // 5 min

// ─── Route ────────────────────────────────────────────────────────────────────
export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const now = new Date();
    const thirtyAgo = new Date(now.getTime() - 30 * 86400_000);

    const expand = ['data.items.data.price'];

    const [productsArr, activeSubs, trialingSubs, cancelledSubs, pastDueSubs] = await Promise.all([
      fetchAll<Stripe.Product>((p) => stripe.products.list(p)),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'active',   expand })),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'trialing', expand })),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'canceled', expand })),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'past_due', expand })),
    ]);

    const products = new Map(productsArr.map(p => [p.id, p]));
    const allSubs  = [...activeSubs, ...trialingSubs, ...cancelledSubs, ...pastDueSubs];

    // ── Current snapshot ──────────────────────────────────────────────────────
    const mrr  = activeSubs.reduce((s, sub) => s + monthlyAmountCents(sub), 0) / 100;
    const arr  = mrr * 12;
    const arpu = activeSubs.length ? mrr / activeSubs.length : 0;

    // MRR & subs by plan (current)
    const mrrByPlan: Record<string, number> = {};
    const subsByPlan: Record<string, number> = {};
    for (const sub of activeSubs) {
      const name = planName(sub, products);
      mrrByPlan[name]  = (mrrByPlan[name]  ?? 0) + monthlyAmountCents(sub) / 100;
      subsByPlan[name] = (subsByPlan[name] ?? 0) + 1;
    }

    // Churn 30j
    const recentlyCancelled = cancelledSubs.filter(
      s => s.canceled_at && s.canceled_at * 1000 >= thirtyAgo.getTime()
    );
    const churnByPlan: Record<string, { active: number; cancelled: number; rate: number; churned_mrr: number }> = {};
    for (const name of Object.keys(subsByPlan)) {
      churnByPlan[name] = { active: subsByPlan[name], cancelled: 0, rate: 0, churned_mrr: 0 };
    }
    for (const sub of recentlyCancelled) {
      const name = planName(sub, products);
      if (!churnByPlan[name]) churnByPlan[name] = { active: 0, cancelled: 0, rate: 0, churned_mrr: 0 };
      churnByPlan[name].cancelled  += 1;
      churnByPlan[name].churned_mrr += monthlyAmountCents(sub) / 100;
    }
    for (const name of Object.keys(churnByPlan)) {
      const { active, cancelled } = churnByPlan[name];
      churnByPlan[name].rate = active + cancelled > 0
        ? r2(cancelled / (active + cancelled) * 100) : 0;
    }

    const denom     = activeSubs.length + recentlyCancelled.length;
    const churnRate = denom > 0 ? r2(recentlyCancelled.length / denom * 100) : 0;
    const ltv       = churnRate > 0 ? r2(arpu / (churnRate / 100)) : 0;

    const newSubs    = activeSubs.filter(s => s.created * 1000 >= thirtyAgo.getTime());
    const newMrr     = newSubs.reduce((s, sub) => s + monthlyAmountCents(sub), 0) / 100;
    const churnedMrr = recentlyCancelled.reduce((s, sub) => s + monthlyAmountCents(sub), 0) / 100;

    // ── Full history (reconstruction from subscriptions) ──────────────────────
    const history = reconstructHistory(allSubs);

    // Growth rate & NRR from last 2 months of history
    const growthRate = history.length >= 2
      ? r2((history.at(-1)!.mrr - history.at(-2)!.mrr) / (history.at(-2)!.mrr || 1) * 100)
      : 0;
    const nrr = history.length >= 2 && history.at(-2)!.mrr
      ? r2(history.at(-1)!.mrr / history.at(-2)!.mrr * 100)
      : 0;

    const data = {
      currency: '€',
      mrr: r2(mrr), arr: r2(arr), arpu: r2(arpu), ltv,
      churn_rate: churnRate, growth_rate: growthRate, nrr,
      active_customers:   activeSubs.length,
      trialing_customers: trialingSubs.length,
      past_due_customers: pastDueSubs.length,
      total_cancelled:    cancelledSubs.length,
      new_mrr: r2(newMrr), churned_mrr: r2(churnedMrr),
      net_mrr: r2(newMrr - churnedMrr),
      new_customers: newSubs.length,
      mrr_by_plan:   mrrByPlan,
      subs_by_plan:  subsByPlan,
      churn_by_plan: churnByPlan,
      history, // ← toute l'historique mois par mois
      last_updated: now.toISOString(),
    };

    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
