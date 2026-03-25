import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { connect } from '../lib/connect';

export async function middleware(request: NextRequest) {
  try {
    await connect();
  } catch (error) {
    console.error('[Middleware] Connection error:', error);
    // Continue anyway - let API routes handle their own connection
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!api|login).*)',
}
