import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ success: true, application: 'zeya', service: 'canonical-representation-state' });
}
