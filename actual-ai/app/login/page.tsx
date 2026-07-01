'use client'

import { FormEvent, Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const formData = new FormData(event.currentTarget)

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        password: formData.get('password'),
      }),
    })

    if (!response.ok) {
      setError('Invalid username or password')
      return
    }

    const requestedRedirect = searchParams.get('redirect')
    const redirectTo =
      requestedRedirect?.startsWith('/') && !requestedRedirect.startsWith('//')
        ? requestedRedirect
        : '/'

    router.push(redirectTo)
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl"
      >
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Login</h1>


        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Password
        </label>
        <input
          name="password"
          placeholder="Password"
          type="password"
          required
          className="mb-6 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-violet-400"
        />

        <button
          type="submit"
          className="w-full rounded-2xl bg-violet-500 px-5 py-3 font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400"
        >
          Login
        </button>

        {error && (
          <p className="mt-4 rounded-xl border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
