'use client'

import * as React from 'react'
import { Bot, X } from 'lucide-react'
import { AiChat } from '@open-mercato/ui/ai'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 })
export const dateShort = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function cityOf(address: string): string {
  const last = address.split(',').pop()?.trim() ?? address
  return last.replace(/\b\d{2}-\d{3}\b/g, '').replace(/\b\d{3}\s\d{2}\b/g, '').replace(/\b\d{4,6}\b/g, '').replace(/\s+/g, ' ').trim()
}

export const DISPATCH_LABELS: Record<string, string> = {
  unassigned: 'Nieprzypisane',
  own_fleet: 'Własna flota',
  subcontractor: 'Podwykonawca',
}

export const RECOMMENDATION_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  own_fleet: { label: 'Własne auto', variant: 'default' },
  subcontractor: { label: 'Podwykonawca', variant: 'secondary' },
  negotiate: { label: 'Negocjuj', variant: 'outline' },
  human_review: { label: 'Decyzja człowieka', variant: 'destructive' },
}

export function DispatchBadge({ mode }: { mode: string }) {
  const variant = mode === 'own_fleet' ? 'default' : mode === 'subcontractor' ? 'secondary' : 'outline'
  return <Badge variant={variant}>{DISPATCH_LABELS[mode] ?? mode}</Badge>
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Updates the logistics custom fields on a sales order through the core sales API. */
export async function updateDispatch(orderId: string, fields: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = { id: orderId }
  for (const [key, value] of Object.entries(fields)) body[`cf_${key}`] = value
  const call = await apiCall<Record<string, unknown>>('/api/sales/orders', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (call.ok) return { ok: true }
  const error = (call.result as { error?: string } | undefined)?.error ?? `HTTP ${call.status}`
  return { ok: false, error }
}

export function AgentPanel({ agent, title, className }: { agent: string; title: string; className?: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant={open ? 'secondary' : 'default'} onClick={() => setOpen((v) => !v)}>
          {open ? <X className="size-4" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
          {open ? 'Zamknij agenta' : title}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 h-[560px] overflow-hidden rounded-lg border border-border bg-card">
          <AiChat agent={agent} className="h-full" placeholder="Opisz zlecenie albo zadaj pytanie…" />
        </div>
      ) : null}
    </div>
  )
}
