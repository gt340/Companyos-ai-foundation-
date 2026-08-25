'use client'

import * as React from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { Fingerprint, Trash2, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface Passkey {
  id: string
  deviceName: string | null
  createdAt: string
  lastUsedAt: string | null
}

export function PasskeysSection() {
  const { toast } = useToast()
  const [passkeys, setPasskeys] = React.useState<Passkey[]>([])
  const [loading, setLoading] = React.useState(true)
  const [registering, setRegistering] = React.useState(false)

  const loadPasskeys = React.useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setLoading(false)
      return
    }

    const { data } = await supabase
      .from('passkeys')
      .select('id, deviceName, createdAt, lastUsedAt')
      .eq('userId', user.id)
      .order('createdAt', { ascending: false })

    setPasskeys(data ?? [])
    setLoading(false)
  }, [])

  React.useEffect(() => {
    loadPasskeys()
  }, [loadPasskeys])

  async function addPasskey() {
    setRegistering(true)
    try {
      const optionsRes = await fetch('/api/security/passkeys/register-options', { method: 'POST' })
      if (!optionsRes.ok) throw new Error('Could not start passkey setup')
      const options = await optionsRes.json()

      const registrationResponse = await startRegistration(options)

      const deviceName =
        typeof navigator !== 'undefined' && /iPhone|iPad/.test(navigator.userAgent)
          ? 'iPhone/iPad'
          : /Android/.test(navigator.userAgent)
            ? 'Android device'
            : /Mac/.test(navigator.userAgent)
              ? 'Mac'
              : 'This device'

      const verifyRes = await fetch('/api/security/passkeys/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: registrationResponse, deviceName }),
      })

      const verifyBody = await verifyRes.json().catch(() => null)
      if (!verifyRes.ok || !verifyBody?.verified) {
        throw new Error(verifyBody?.error ?? 'Passkey verification failed')
      }

      toast({ variant: 'success', title: 'Passkey added' })
      loadPasskeys()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      // Users tapping "Cancel" on the OS biometric prompt lands here too — not a real error.
      if (message.toLowerCase().includes('cancel') || message.toLowerCase().includes('not allowed')) {
        setRegistering(false)
        return
      }
      toast({ variant: 'destructive', title: "Couldn't add passkey", description: message })
    } finally {
      setRegistering(false)
    }
  }

  async function removePasskey(id: string) {
    const supabase = createClient()
    const { error } = await supabase.from('passkeys').delete().eq('id', id)
    if (error) {
      toast({ variant: 'destructive', title: "Couldn't remove", description: error.message })
      return
    }
    toast({ title: 'Passkey removed' })
    loadPasskeys()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Passkeys</CardTitle>
        <CardDescription>Sign in using your device's fingerprint, face, or screen lock — no password needed.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys added yet.</p>
        ) : (
          passkeys.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-signal" />
                <div>
                  <p className="text-sm font-medium">{p.deviceName || 'Passkey'}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(p.createdAt).toLocaleDateString()}
                    {p.lastUsedAt && ` · Last used ${new Date(p.lastUsedAt).toLocaleDateString()}`}
                  </p>
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => removePasskey(p.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
      <CardFooter className="justify-end border-t border-border pt-6">
        <Button variant="signal" onClick={addPasskey} disabled={registering}>
          {registering && <Loader2 className="h-4 w-4 animate-spin" />}
          <Fingerprint className="h-4 w-4" />
          Add a passkey
        </Button>
      </CardFooter>
    </Card>
  )
}
