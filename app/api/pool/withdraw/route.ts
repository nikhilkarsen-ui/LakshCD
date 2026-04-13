// POST /api/pool/withdraw
//
// Mid-season NAV withdrawal. Liquidates the user's entire portfolio
// at current prices, deducts the early exit fee (3%), and pays the remainder.
//
// The exit fee stays in the pool — it increases payouts for remaining participants.
//
// This cannot be undone. The user is fully exited from the season.

import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAppUser, unauth } from '@/lib/auth';
import { executePoolWithdrawal } from '@/lib/trading';
import { POOL, SEASON } from '@/config/constants';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getApprovedAppUser(req);
  if (!user) return unauth();

  // Withdrawals are not allowed after settlement date
  if (Date.now() >= new Date(SEASON.settlement_date).getTime()) {
    return NextResponse.json(
      { error: 'Season has ended. Settlement payouts have been distributed.' },
      { status: 400 },
    );
  }

  // Require explicit confirmation in request body to prevent accidental calls
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: 'Send { "confirm": true } to confirm the withdrawal. This action cannot be undone.' },
      { status: 400 },
    );
  }

  const result = await executePoolWithdrawal(user.id);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success:       true,
    nav:           result.nav,
    exit_fee:      result.exit_fee,
    exit_fee_pct:  POOL.early_exit_fee * 100,
    payout:        result.payout,
    message:       `Your portfolio has been liquidated. $${result.payout?.toFixed(2)} has been credited to your account. ($${result.exit_fee?.toFixed(2)} early exit fee retained in pool.)`,
  });
}
