
import { NextRequest, NextResponse } from "next/server"

import { isValidSessionToken, SESSION_COOKIE } from "@/app/lib/auth"

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/me",
  "/favicon.ico",
]

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isPublicPath =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/assets")

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const hasValidSession = await isValidSessionToken(
    token,
    process.env.ACTUAL_PASSWORD,
  )

  if (!hasValidSession && !isPublicPath) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = "/login"
    loginUrl.searchParams.set("redirect", pathname)

    return NextResponse.redirect(loginUrl)
  }

  if (hasValidSession && pathname === "/login") {
    const homeUrl = req.nextUrl.clone()
    homeUrl.pathname = "/"
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api/auth/login|_next/static|_next/image|favicon.ico).*)"],
}
