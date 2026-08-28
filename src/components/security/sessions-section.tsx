'use client'

import * as React from 'react'
import { Loader2, Monitor, ShieldAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface Session {
  id: string
  loginMethod: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  lastActiveAt: string
  revokedAt: string | null
}

function describeDevice(userAgent: string | null) {
  if (!userAgent) return 'Unknown device'
  if (/iPhone|iPad/.test(userAgent)) return 'iPhone/iPad'
  if (/Android/.test(userAgent)) return 'Android device'
  if (/Macintosh/.test(userAgent)) return 'Mac'
  if (/Windows/.test(userAgent)) return 'Windows PC'
  return 'Unknown device'
}

export function SessionsSection() {
  const { toast } = useToast()
  const [sessions, setSessions] = React.useState<Session[]>([])
  const [loading, setLoading] = React.useState(true)

  const loadSessions = React.useCallback(async () => {
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
      .from('user_sessions')
      .select('id, loginMethod, ipAddress, userAgent, createdAt, lastActiveAt, revokedAt')
      .eq('userId', user.id)
      .is('revokedAt', null)
      .order('lastActiveAt', { ascending: false })
      .limit(20)

    setSessions(data ?? [])
    setLoading(false)
  }, [])

  React.useEffect(() => {
    loadSessions()
  }, [loadSessions])

  async function revoke(id: string) {
    const supabase = createClient()
    const { error } = await supabase
      .from('user_sessions')
      .update({ revokedAt: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      toast({ variant: 'destructive', title: "Couldn't revoke session", description: error.message })
      return
    }
    toast({ title: 'Session marked as revoked' })
    loadSessions()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sign-in history</CardTitle>
        <CardDescription>Recent sign-ins to your account, most recent first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sign-in history recorded yet.</p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {describeDevice(s.userAgent)} · <span className="capitalize">{s.loginMethod}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last active {new Date(s.lastActiveAt).toLocaleString()}
                    {s.ipAddress && ` · ${s.ipAddress}`}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                <ShieldAlert className="h-4 w-4" /> Not me
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
