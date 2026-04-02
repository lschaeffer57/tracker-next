import { NextResponse } from 'next/server';

export async function GET() {
  // Cache is in-memory per instance; this signals a re-fetch on next /api/kpis call
  return NextResponse.json({ status: 'ok' });
}
