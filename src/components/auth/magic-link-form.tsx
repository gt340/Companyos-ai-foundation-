'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export function MagicLinkForm({ redirectTo }: { redirectTo?: string }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const { toast } = useToast()

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()

    const callbackUrl = new URL('/auth/callback', window.location.origin)
    if (redirectTo) {
      callbackUrl.searchParams.set('redirectTo', redirectTo)
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
      },
    })

    setLoading(false)

    if (error) {
      toast({ variant: 'destructive', title: "Couldn't send link", description: error.message })
      return
    }

    setSent(true)
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>. Click it to continue.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSendLink} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="magic-email">Email</Label>
        <Input
          id="magic-email"
          type="email"
          required
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={loading || !email}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Send magic link
      </Button>
    </form>
  )
    }
