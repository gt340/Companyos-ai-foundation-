'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function MicrosoftSignInButton({ redirectTo }: { redirectTo?: string }) {
  const [loading, setLoading] = useState(false)

  const handleMicrosoftSignIn = async () => {
    setLoading(true)
    const supabase = createClient()

    const callbackUrl = new URL('/auth/callback', window.location.origin)
    if (redirectTo) {
      callbackUrl.searchParams.set('redirectTo', redirectTo)
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: callbackUrl.toString(),
        scopes: 'email openid profile',
      },
    })

    if (error) {
      console.error('Microsoft sign-in error:', error.message)
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleMicrosoftSignIn}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
    >
      <svg className="h-5 w-5" viewBox="0 0 21 21">
        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
      </svg>
      {loading ? 'Redirecting…' : 'Continue with Microsoft'}
    </button>
  )
}
