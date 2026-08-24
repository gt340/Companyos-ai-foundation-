'use client'

import * as React from 'react'
import { Loader2, ShieldCheck, ShieldOff, Copy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

interface Factor {
  id: string
  friendly_name?: string
  factor_type: string
  status: string
}

export function TwoFactorSection() {
  const { toast } = useToast()
  const [factors, setFactors] = React.useState<Factor[]>([])
  const [loading, setLoading] = React.useState(true)

  // Enrollment flow state
  const [enrolling, setEnrolling] = React.useState(false)
  const [qrCode, setQrCode] = React.useState<string | null>(null)
  const [factorId, setFactorId] = React.useState<string | null>(null)
  const [verifyCode, setVerifyCode] = React.useState('')
  const [verifying, setVerifying] = React.useState(false)
  const [backupCodes, setBackupCodes] = React.useState<string[] | null>(null)

  const supabase = createClient()

  const loadFactors = React.useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (!error && data) {
      setFactors(data.totp.filter((f) => f.status === 'verified'))
    }
    setLoading(false)
  }, [supabase])

  React.useEffect(() => {
    loadFactors()
  }, [loadFactors])

  async function startEnrollment() {
    setEnrolling(true)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    if (error) {
      toast({ variant: 'destructive', title: "Couldn't start 2FA setup", description: error.message })
      setEnrolling(false)
      return
    }
    setFactorId(data.id)
    setQrCode(data.totp.qr_code)
  }

  async function confirmEnrollment() {
    if (!factorId || !verifyCode) return
    setVerifying(true)

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError) {
      toast({ variant: 'destructive', title: 'Verification failed', description: challengeError.message })
      setVerifying(false)
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: verifyCode,
    })

    if (verifyError) {
      toast({ variant: 'destructive', title: 'Incorrect code', description: 'Check your authenticator app and try again.' })
      setVerifying(false)
      return
    }

    // Generate backup codes server-side and store them hashed
    const res = await fetch('/api/security/backup-codes', { method: 'POST' })
    const body = await res.json().catch(() => null)

    setVerifying(false)
    setQrCode(null)
    setVerifyCode('')
    setEnrolling(false)
    setBackupCodes(body?.codes ?? null)
    toast({ variant: 'success', title: 'Two-factor authentication enabled' })
    loadFactors()
  }

  async function removeFactor(id: string) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id })
    if (error) {
      toast({ variant: 'destructive', title: "Couldn't remove", description: error.message })
      return
    }
    toast({ title: '2FA removed' })
    loadFactors()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Two-factor authentication</CardTitle>
        <CardDescription>Add an extra layer of security using an authenticator app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : backupCodes ? (
          <div className="space-y-3 rounded-md border border-border bg-muted p-4">
            <p className="text-sm font-medium">Save your backup codes</p>
            <p className="text-xs text-muted-foreground">
              Store these somewhere safe. Each can be used once if you lose access to your authenticator app.
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(backupCodes.join('\n'))
                toast({ title: 'Copied' })
              }}
            >
              <Copy className="h-4 w-4" /> Copy codes
            </Button>
            <Button size="sm" variant="signal" onClick={() => setBackupCodes(null)}>
              Done
            </Button>
          </div>
        ) : factors.length > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-signal" />
              <span className="text-sm font-medium">Authenticator app enabled</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => removeFactor(factors[0].id)}>
              <ShieldOff className="h-4 w-4" /> Remove
            </Button>
          </div>
        ) : enrolling && qrCode ? (
          <div className="space-y-4">
            <img src={qrCode} alt="Scan with your authenticator app" className="h-40 w-40" />
            <div className="space-y-2">
              <Label htmlFor="totp-code">Enter the 6-digit code from your app</Label>
              <Input
                id="totp-code"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                maxLength={6}
                inputMode="numeric"
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Two-factor authentication is not enabled yet.</p>
        )}
      </CardContent>
      {!loading && !backupCodes && (
        <CardFooter className="justify-end border-t border-border pt-6">
          {factors.length === 0 && !enrolling && (
            <Button variant="signal" onClick={startEnrollment}>
              Enable 2FA
            </Button>
          )}
          {enrolling && qrCode && (
            <Button variant="signal" disabled={verifying || verifyCode.length !== 6} onClick={confirmEnrollment}>
              {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
              Verify and enable
            </Button>
          )}
        </CardFooter>
      )}
    </Card>
  )
  }
