import Stripe from 'stripe';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

let _stripe: Stripe | null = null;
function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}
const stripe = { get products() { return getStripe().products; }, get subscriptions() { return getStripe().subscriptions; }, get invoices() { return getStripe().invoices; } };

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

let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 300_000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const now = new Date();
    const thirtyAgo = new Date(now.getTime() - 30 * 86400_000);

    const [productsArr, activeSubs, trialingSubs, cancelledSubs, pastDueSubs, invoices] = await Promise.all([
      fetchAll<Stripe.Product>((p) => stripe.products.list(p)),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'active', expand: ['data.items.data.price'] })),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'trialing', expand: ['data.items.data.price'] })),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'canceled', expand: ['data.items.data.price'] })),
      fetchAll<Stripe.Subscription>((p) => stripe.subscriptions.list({ ...p, status: 'past_due', expand: ['data.items.data.price'] })),
      fetchAll<Stripe.Invoice>((p) => stripe.invoices.list({ ...p, status: 'paid' })), // tout l'historique
    ]);

    const products = new Map(productsArr.map(p => [p.id, p]));

    // MRR
    const mrr = activeSubs.reduce((s, sub) => s + monthlyAmountCents(sub), 0) / 100;
    const arr = mrr * 12;
    const arpu = activeSubs.length ? mrr / activeSubs.length : 0;

    // MRR & subs by plan
    const mrrByPlan: Record<string, number> = {};
    const subsByPlan: Record<string, number> = {};
    for (const sub of activeSubs) {
      const name = planName(sub, products);
      mrrByPlan[name]  = (mrrByPlan[name]  ?? 0) + monthlyAmountCents(sub) / 100;
      subsByPlan[name] = (subsByPlan[name] ?? 0) + 1;
    }

    // Churn (30j)
    const recentlyCancelled = cancelledSubs.filter(s => s.canceled_at && s.canceled_at * 1000 >= thirtyAgo.getTime());
    const churnByPlan: Record<string, { active: number; cancelled: number; rate: number; churned_mrr: number }> = {};
    for (const name of Object.keys(subsByPlan)) {
      churnByPlan[name] = { active: subsByPlan[name], cancelled: 0, rate: 0, churned_mrr: 0 };
    }
    for (const sub of recentlyCancelled) {
      const name = planName(sub, products);
      if (!churnByPlan[name]) churnByPlan[name] = { active: 0, cancelled: 0, rate: 0, churned_mrr: 0 };
      churnByPlan[name].cancelled += 1;
      churnByPlan[name].churned_mrr += monthlyAmountCents(sub) / 100;
    }
    for (const name of Object.keys(churnByPlan)) {
      const { active, cancelled } = churnByPlan[name];
      churnByPlan[name].rate = active + cancelled > 0 ? Math.round(cancelled / (active + cancelled) * 10000) / 100 : 0;
    }

    const denom = activeSubs.length + recentlyCancelled.length;
    const churnRate = denom > 0 ? Math.round(recentlyCancelled.length / denom * 10000) / 100 : 0;
    const ltv = churnRate > 0 ? Math.round(arpu / (churnRate / 100) * 100) / 100 : 0;

    // New MRR & churned MRR (30j)
    const newSubs = activeSubs.filter(s => s.created * 1000 >= thirtyAgo.getTime());
    const newMrr = newSubs.reduce((s, sub) => s + monthlyAmountCents(sub), 0) / 100;
    const churnedMrr = recentlyCancelled.reduce((s, sub) => s + monthlyAmountCents(sub), 0) / 100;

    // Historical MRR
    const monthlyRev: Record<string, number> = {};
    for (const inv of invoices) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(inv as any).subscription || !inv.amount_paid) continue;
      const key = new Date(inv.created * 1000).toISOString().slice(0, 7);
      monthlyRev[key] = (monthlyRev[key] ?? 0) + inv.amount_paid / 100;
    }
    const sortedMonths = Object.keys(monthlyRev).sort();
    const growthRate = sortedMonths.length >= 2
      ? Math.round((monthlyRev[sortedMonths.at(-1)!] - monthlyRev[sortedMonths.at(-2)!]) / monthlyRev[sortedMonths.at(-2)!] * 10000) / 100
      : 0;
    const nrr = sortedMonths.length >= 2 && monthlyRev[sortedMonths.at(-2)!]
      ? Math.round(monthlyRev[sortedMonths.at(-1)!] / monthlyRev[sortedMonths.at(-2)!] * 10000) / 100
      : 0;

    const data = {
      currency: '€',
      mrr: Math.round(mrr * 100) / 100,
      arr: Math.round(arr * 100) / 100,
      arpu: Math.round(arpu * 100) / 100,
      ltv,
      churn_rate: churnRate,
      growth_rate: growthRate,
      nrr,
      active_customers: activeSubs.length,
      trialing_customers: trialingSubs.length,
      past_due_customers: pastDueSubs.length,
      total_cancelled: cancelledSubs.length,
      new_mrr: Math.round(newMrr * 100) / 100,
      churned_mrr: Math.round(churnedMrr * 100) / 100,
      net_mrr: Math.round((newMrr - churnedMrr) * 100) / 100,
      new_customers: newSubs.length,
      mrr_by_plan: mrrByPlan,
      subs_by_plan: subsByPlan,
      churn_by_plan: churnByPlan,
      monthly_mrr: { labels: sortedMonths, values: sortedMonths.map(m => Math.round(monthlyRev[m] * 100) / 100) },
      last_updated: now.toISOString(),
    };

    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
