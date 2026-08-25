'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startAuthentication } from '@simplewebauthn/browser'
import { Fingerprint, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

export function PasskeySignInButton({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [email, setEmail] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    if (!email) {
      setShowEmailInput(true)
      return
    }

    setLoading(true)
    try {
      const optionsRes = await fetch('/api/security/passkeys/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const optionsBody = await optionsRes.json().catch(() => null)

      if (!optionsRes.ok) {
        throw new Error(optionsBody?.error ?? 'No passkey found for this email')
      }

      const authResponse = await startAuthentication(optionsBody.options)

      const verifyRes = await fetch('/api/security/passkeys/auth-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse, userId: optionsBody.userId }),
      })
      const verifyBody = await verifyRes.json().catch(() => null)

      if (!verifyRes.ok || !verifyBody?.verified) {
        throw new Error(verifyBody?.error ?? 'Sign-in failed')
      }

      router.push(redirectTo || '/dashboard')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      if (message.toLowerCase().includes('cancel') || message.toLowerCase().includes('not allowed')) {
        setLoading(false)
        return
      }
      toast({ variant: 'destructive', title: "Couldn't sign in with passkey", description: message })
    } finally {
      setLoading(false)
    }
  }

  if (showEmailInput) {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="passkey-email">Email</Label>
          <Input
            id="passkey-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoFocus
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleSignIn}
          disabled={loading || !email}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
          Continue with passkey
        </Button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleSignIn}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
    >
      <Fingerprint className="h-5 w-5" />
      Sign in with a passkey
    </button>
  )
      }
