import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { connect } from '../lib/connect';

export async function middleware(request: NextRequest) {
    console.log("middleware")
    console.log(request)
    await connect();

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!login).*)',
}
