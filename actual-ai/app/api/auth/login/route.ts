import { NextResponse } from 'next/server'

import {
  createSessionToken,
  passwordMatches,
  SESSION_COOKIE,
} from '@/app/lib/auth'

export async function POST(request: Request) {
  const actualPassword = process.env.ACTUAL_PASSWORD

  if (!actualPassword) {
    return NextResponse.json(
      { error: 'Authentication is not configured' },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const password =
    typeof body === 'object' &&
    body !== null &&
    'password' in body &&
    typeof body.password === 'string'
      ? body.password
      : null

  if (password === null) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  }

  if (!(await passwordMatches(password, actualPassword))) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(SESSION_COOKIE, await createSessionToken(actualPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return response
}
