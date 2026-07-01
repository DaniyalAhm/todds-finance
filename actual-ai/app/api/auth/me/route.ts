import { NextRequest, NextResponse } from 'next/server'

import { isValidSessionToken, SESSION_COOKIE } from '@/app/lib/auth'

export async function GET(request: NextRequest) {
  const password = process.env.ACTUAL_PASSWORD
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const authenticated = await isValidSessionToken(token, password)

  if (!authenticated) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  return NextResponse.json({
    user: {
      username: process.env.AUTH_USERNAME || 'Authenticated user',
    },
  })
}
