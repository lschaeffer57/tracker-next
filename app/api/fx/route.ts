import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR', {
      next: { revalidate: 3600 }, // cache 1h
    });
    const data = await res.json();
    return NextResponse.json({ usd_to_eur: data.rates.EUR, date: data.date });
  } catch {
    return NextResponse.json({ usd_to_eur: 0.92, date: null }); // fallback
  }
}
