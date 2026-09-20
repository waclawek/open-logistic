'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { BackloadCandidate } from '../lib/exchange'
import type { LogisticsRoute } from '../lib/types'
import {
  DEMO_BACKLOAD_RADIUS_KM,
  DEMO_TRIP_TICK_MS,
  type BackloadScanState,
  type HistoryEntry,
  type TransportRunStatus,
  type TransportRunView,
} from '../lib/transport-run-model'
import { TransportRunMap } from './TransportRunMap'

type RunsResponse = { items: TransportRunView[]; total: number }

type AdvanceResponse = {
  run: TransportRunView
  aheadCandidates?: BackloadCandidate[]
}

type InboxPhase = 'needs_you' | 'agent_working' | 'in_progress' | 'done'

type FilterId = 'needs_you' | 'agent_working' | 'in_progress' | 'done' | 'all'

const FILTERS: FilterId[] = ['needs_you', 'agent_working', 'in_progress', 'done', 'all']

const FILTER_I18N: Record<FilterId, string> = {
  needs_you: 'logistics.inbox.filter.needsYou',
  agent_working: 'logistics.inbox.filter.agentWorking',
  in_progress: 'logistics.inbox.filter.inProgress',
  done: 'logistics.inbox.filter.done',
  all: 'logistics.inbox.filter.all',
}

/** Production cadence for agent search ticks (carrier / doładunek). */
export const AGENT_TICK_PROD_MS = 5 * 60 * 1000
/** Demo cadence — same logic, faster loop so the operator sees progress. */
export const AGENT_TICK_DEMO_MS = 10_000
/** @deprecated alias — inbox uses demo tick */
export const AGENT_TICK_MS = AGENT_TICK_DEMO_MS
/** Visual corridor sweep for the search radius (~8s), starting at the truck. */
const SCAN_SWEEP_MS = 8_000
const SCAN_SWEEP_STEPS = 40

type StageClock = { key: string; startedAt: number }

function inboxPhase(status: TransportRunStatus, agentBusy: boolean): InboxPhase {
  if (status === 'carrier_proposal_pending' || status === 'backload_proposal_pending') return 'needs_you'
  if (status === 'completed' || status === 'cancelled') return 'done'
  if (agentBusy || status === 'awaiting_carrier_search' || status === 'approved') return 'agent_working'
  return 'in_progress'
}

function phaseBadge(phase: InboxPhase): { variant: StatusBadgeVariant; key: string } {
  switch (phase) {
    case 'needs_you':
      return { variant: 'warning', key: 'logistics.inbox.phase.needsYou' }
    case 'agent_working':
      return { variant: 'info', key: 'logistics.inbox.phase.agentWorking' }
    case 'in_progress':
      return { variant: 'neutral', key: 'logistics.inbox.phase.inProgress' }
    case 'done':
      return { variant: 'success', key: 'logistics.inbox.phase.done' }
  }
}

function agentForStatus(status: TransportRunStatus): 'carrier_finder' | 'load_optimizer' | null {
  if (
    status === 'awaiting_carrier_search' ||
    status === 'carrier_proposal_pending' ||
    status === 'approved'
  ) {
    return 'carrier_finder'
  }
  if (status === 'in_transit' || status === 'backload_proposal_pending') return 'load_optimizer'
  return null
}

function phaseActivityKey(status: TransportRunStatus): string {
  switch (status) {
    case 'awaiting_carrier_search':
      return 'logistics.inbox.activity.searchingCarrier'
    case 'carrier_proposal_pending':
      return 'logistics.inbox.activity.awaitingCarrierHitl'
    case 'approved':
      return 'logistics.inbox.activity.startingDelivery'
    case 'in_transit':
      return 'logistics.inbox.activity.monitoringTruck'
    case 'backload_proposal_pending':
      return 'logistics.inbox.activity.awaitingBackloadHitl'
    case 'completed':
      return 'logistics.inbox.activity.completed'
    case 'cancelled':
      return 'logistics.inbox.activity.cancelled'
  }
}

function historyTitleKey(event: string): string {
  const map: Record<string, string> = {
    run_started: 'logistics.inbox.history.runStarted',
    active_vehicle_search: 'logistics.inbox.history.vehicleSearch',
    passive_listing_published: 'logistics.inbox.history.listingPublished',
    carrier_proposed: 'logistics.inbox.history.carrierProposed',
    carrier_approved: 'logistics.inbox.history.carrierApproved',
    carrier_rejected: 'logistics.inbox.history.carrierRejected',
    delivery_started: 'logistics.inbox.history.deliveryStarted',
    delivery_completed: 'logistics.inbox.history.deliveryCompleted',
    truck_advanced: 'logistics.inbox.history.truckAdvanced',
    backload_scan: 'logistics.inbox.history.backloadScan',
    backload_scan_reset: 'logistics.inbox.history.backloadScanReset',
    backload_proposed: 'logistics.inbox.history.backloadProposed',
    backload_approved: 'logistics.inbox.history.backloadApproved',
    backload_rejected: 'logistics.inbox.history.backloadRejected',
  }
  return map[event] ?? 'logistics.inbox.history.generic'
}

/**
 * Turn agent scrap notes (bullets, tool dumps, repeated newlines) into short readable prose
 * for the decision card — keep sense, drop the shreds.
 */
function formatAgentProse(raw: string, maxChars = 320): string {
  let text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) return ''
  // Drop fenced dumps / JSON-ish blobs
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/\{[^{}]{40,}\}/g, ' ')
  // Bullets / numbered lines → sentence pieces
  text = text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .join(' ')
  text = text.replace(/\s+/g, ' ').trim()
  // Soft-cap at a sentence boundary when possible
  if (text.length <= maxChars) return text
  const slice = text.slice(0, maxChars)
  const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (stop >= Math.floor(maxChars * 0.45)) return slice.slice(0, stop + 1).trim()
  const space = slice.lastIndexOf(' ')
  return `${(space > 40 ? slice.slice(0, space) : slice).trim()}…`
}

async function postRunAction(
  runId: string,
  body: Record<string, unknown>,
): Promise<AdvanceResponse> {
  return readApiResultOrThrow<AdvanceResponse>(`/api/logistics/transport-runs/${runId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type AgentStepResponse = {
  skipped?: boolean
  reason?: string
  agentId?: string
  agent?: 'carrier_finder' | 'load_optimizer'
  agentText?: string
  run: TransportRunView | null
  error?: string
  message?: string
}

async function runLlmAgentStep(
  runId: string,
  opts?: { stageElapsedMs?: number; force?: boolean },
): Promise<AgentStepResponse> {
  return readApiResultOrThrow<AgentStepResponse>(`/api/logistics/transport-runs/${runId}/agent-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stageElapsedMs: opts?.stageElapsedMs,
      force: opts?.force,
    }),
  })
}

function pointAtPct(route: LogisticsRoute, progressPct: number): { lat: number; lng: number } {
  const coords = route.points.coordinates
  const pct = Math.min(100, Math.max(0, progressPct))
  const idx = Math.min(coords.length - 1, Math.floor((pct / 100) * (coords.length - 1)))
  const [lng, lat] = coords[idx]!
  return { lat, lng }
}

function HistoryStep({ entry }: { entry: HistoryEntry }) {
  const t = useT()
  const payload = entry.payload
  const hasPayload = Boolean(payload && Object.keys(payload).length > 0)
  const title = t(historyTitleKey(entry.event))
  if (!hasPayload) {
    return (
      <li className="rounded-md border border-border px-3 py-2 text-xs">
        <div className="font-medium text-foreground">{title}</div>
        {entry.detail ? <p className="mt-0.5 text-muted-foreground">{entry.detail}</p> : null}
        <p className="mt-0.5 text-muted-foreground">{entry.at}</p>
      </li>
    )
  }
  return (
    <li>
      <details className="rounded-md border border-border px-3 py-2 text-xs open:bg-muted/30">
        <summary className="cursor-pointer list-none font-medium text-foreground [&::-webkit-details-marker]:hidden">
          <span className="flex items-start justify-between gap-2">
            <span>
              {title}
              {entry.detail ? (
                <span className="mt-0.5 block font-normal text-muted-foreground">{entry.detail}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-muted-foreground">{entry.at.slice(11, 19)}</span>
          </span>
        </summary>
        <dl className="mt-2 space-y-1.5 border-t border-border pt-2 text-muted-foreground">
          {Object.entries(payload!).map(([key, value]) => (
            <div key={key}>
              <dt className="font-medium text-foreground">{key}</dt>
              <dd className="whitespace-pre-wrap break-words">
                {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                  ? String(value)
                  : JSON.stringify(value, null, 2)}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  )
}

export function LogisticsAgentInbox() {
  const t = useT()
  const [runs, setRuns] = useState<TransportRunView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterId>('needs_you')
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [agentsEnabled, setAgentsEnabled] = useState(true)
  /** Client-only radius sweep while agent searches the corridor. */
  const [localSweeps, setLocalSweeps] = useState<Record<string, BackloadScanState>>({})
  const tickingRef = useRef(false)
  const advancingRef = useRef(false)
  const sweepTimers = useRef<Record<string, number>>({})
  const stageClockRef = useRef<Record<string, StageClock>>({})
  const runsRef = useRef(runs)
  const busyIdsRef = useRef(busyIds)
  runsRef.current = runs
  busyIdsRef.current = busyIds

  const stageElapsedMs = useCallback((run: TransportRunView) => {
    const key = `${run.status}:${run.backloadScan?.status ?? 'idle'}`
    const cur = stageClockRef.current[run.id]
    if (!cur || cur.key !== key) {
      stageClockRef.current[run.id] = { key, startedAt: Date.now() }
      return 0
    }
    return Date.now() - cur.startedAt
  }, [])

  const upsertRun = useCallback((run: TransportRunView) => {
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.id === run.id)
      if (idx < 0) return [run, ...prev]
      const next = prev.slice()
      next[idx] = { ...prev[idx], ...run, route: run.route ?? prev[idx]?.route ?? null }
      return next
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await readApiResultOrThrow<RunsResponse>('/api/logistics/transport-runs')
      setRuns(data.items)
      setSelectedId((prev) => prev ?? data.items[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useAppEvent('logistics.transport_run.started', () => void load(), [load])

  const setBusy = useCallback((runId: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(runId)
      else next.delete(runId)
      return next
    })
  }, [])

  const startSweep = useCallback(
    (runId: string, route: LogisticsRoute | null | undefined, fromProgressPct = 0) => {
      if (!route?.points?.coordinates?.length) return
      if (sweepTimers.current[runId]) window.clearInterval(sweepTimers.current[runId])
      const startPct = Math.min(99, Math.max(0, fromProgressPct))
      let step = 0
      setLocalSweeps((prev) => ({
        ...prev,
        [runId]: {
          status: 'scanning',
          radiusKm: DEMO_BACKLOAD_RADIUS_KM,
          progressPct: startPct,
          center: pointAtPct(route, startPct),
          candidatesCount: 0,
          lastScanAt: new Date().toISOString(),
          aheadCandidateIds: [],
        },
      }))
      const interval = window.setInterval(() => {
        step += 1
        const progressPct = Math.min(
          100,
          startPct + ((100 - startPct) * step) / SCAN_SWEEP_STEPS,
        )
        setLocalSweeps((prev) => ({
          ...prev,
          [runId]: {
            status: progressPct >= 100 ? 'done' : 'scanning',
            radiusKm: DEMO_BACKLOAD_RADIUS_KM,
            progressPct,
            center: pointAtPct(route, progressPct),
            candidatesCount: prev[runId]?.candidatesCount ?? 0,
            lastScanAt: prev[runId]?.lastScanAt ?? new Date().toISOString(),
            aheadCandidateIds: prev[runId]?.aheadCandidateIds ?? [],
          },
        }))
        if (progressPct >= 100) {
          window.clearInterval(interval)
          delete sweepTimers.current[runId]
        }
      }, SCAN_SWEEP_MS / SCAN_SWEEP_STEPS)
      sweepTimers.current[runId] = interval
    },
    [],
  )

  useEffect(() => {
    return () => {
      for (const id of Object.values(sweepTimers.current)) window.clearInterval(id)
    }
  }, [])

  const tickEligible = useCallback(async () => {
    if (!agentsEnabled || tickingRef.current) return
    tickingRef.current = true
    try {
      const snapshot = runsRef.current.filter(
        (r) =>
          r.status === 'awaiting_carrier_search' ||
          r.status === 'approved' ||
          (r.status === 'in_transit' && r.backloadScan.status === 'idle'),
      )
      for (const run of snapshot) {
        if (busyIdsRef.current.has(run.id)) continue
        setBusy(run.id, true)
        try {
          if (run.status === 'in_transit' && run.backloadScan.status === 'idle') {
            startSweep(run.id, run.route, run.truck?.progressPct ?? 0)
          }
          const elapsed = stageElapsedMs(run)
          const step = await runLlmAgentStep(run.id, { stageElapsedMs: elapsed })
          if (step.run) upsertRun(step.run)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(run.id, false)
        }
      }
    } finally {
      tickingRef.current = false
    }
  }, [agentsEnabled, setBusy, stageElapsedMs, startSweep, upsertRun])

  useEffect(() => {
    if (!agentsEnabled) return
    void tickEligible()
    const id = window.setInterval(() => {
      void tickEligible()
    }, AGENT_TICK_MS)
    return () => window.clearInterval(id)
  }, [agentsEnabled, tickEligible])

  /** Demo truck: ~2 min trip, 1 Hz along GraphHopper polyline. */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (advancingRef.current) return
      const moving = runsRef.current.filter(
        (r) => r.status === 'in_transit' && (r.truck?.progressPct ?? 0) < 100,
      )
      if (moving.length === 0) return
      advancingRef.current = true
      void (async () => {
        try {
          for (const run of moving) {
            try {
              const data = await postRunAction(run.id, { action: 'advance' })
              upsertRun(data.run)
            } catch {
              // ignore single-tick failures
            }
          }
        } finally {
          advancingRef.current = false
        }
      })()
    }, DEMO_TRIP_TICK_MS)
    return () => window.clearInterval(id)
  }, [upsertRun])

  async function hitl(runId: string, body: Record<string, unknown>) {
    setBusy(runId, true)
    setError(null)
    try {
      const data = await postRunAction(runId, body)
      upsertRun(data.run)
      setSelectedId(data.run.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(runId, false)
    }
  }

  async function searchBackloadAgain(run: TransportRunView) {
    setBusy(run.id, true)
    setError(null)
    try {
      const reset = await postRunAction(run.id, { action: 'reset-backload-scan' })
      upsertRun(reset.run)
      startSweep(run.id, reset.run.route ?? run.route, reset.run.truck?.progressPct ?? run.truck?.progressPct ?? 0)
      const step = await runLlmAgentStep(run.id, {
        stageElapsedMs: stageElapsedMs(reset.run),
      })
      if (step.run) upsertRun(step.run)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(run.id, false)
    }
  }

  async function startDemo() {
    setError(null)
    try {
      const data = await readApiResultOrThrow<{ run: TransportRunView }>('/api/logistics/transport-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed-demo' }),
      })
      upsertRun(data.run)
      setSelectedId(data.run.id)
      setFilter('all')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const rows = useMemo(() => {
    return runs.map((run) => {
      const busy = busyIds.has(run.id)
      const phase = inboxPhase(run.status, busy)
      return { run, busy, phase, agent: agentForStatus(run.status) }
    })
  }, [runs, busyIds])

  const counts = useMemo(() => {
    const base: Record<FilterId, number> = {
      needs_you: 0,
      agent_working: 0,
      in_progress: 0,
      done: 0,
      all: rows.length,
    }
    for (const row of rows) base[row.phase] += 1
    return base
  }, [rows])

  const visible = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter((r) => r.phase === filter)
  }, [rows, filter])

  const selectedRow =
    visible.find((r) => r.run.id === selectedId) ??
    rows.find((r) => r.run.id === selectedId) ??
    visible[0] ??
    null

  const effectiveScan: BackloadScanState | null = selectedRow
    ? localSweeps[selectedRow.run.id]?.status === 'scanning' ||
      (localSweeps[selectedRow.run.id] != null &&
        localSweeps[selectedRow.run.id]!.progressPct < 100 &&
        localSweeps[selectedRow.run.id]!.status !== 'idle')
      ? localSweeps[selectedRow.run.id]!
      : selectedRow.run.backloadScan.status === 'scanning'
        ? selectedRow.run.backloadScan
        : null
    : null

  if (loading) return <LoadingMessage label={t('logistics.inbox.loading')} />

  return (
    <div className="space-y-4" data-testid="logistics-agent-inbox">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void startDemo()}>
          {t('logistics.inbox.startDemo')}
        </Button>
        <Button type="button" variant="outline" onClick={() => void load()}>
          {t('logistics.orders.refresh')}
        </Button>
        <Button
          type="button"
          variant={agentsEnabled ? 'secondary' : 'outline'}
          onClick={() => setAgentsEnabled((v) => !v)}
        >
          {agentsEnabled ? t('logistics.inbox.agentsOn') : t('logistics.inbox.agentsOff')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2" role="tablist">
        {FILTERS.map((id) => {
          const active = filter === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={
                active
                  ? 'rounded-md bg-muted px-3 py-1.5 text-sm font-medium'
                  : 'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/60'
              }
              onClick={() => setFilter(id)}
            >
              {t(FILTER_I18N[id])}
              <span className="ml-1.5 tabular-nums text-muted-foreground">{counts[id]}</span>
            </button>
          )
        })}
      </div>

      {error ? <ErrorMessage label={error} /> : null}

      {visible.length === 0 ? (
        <EmptyState title={t('logistics.inbox.empty')} description={t('logistics.inbox.emptyHint')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
          <ul className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border border-border p-2">
            {visible.map(({ run, busy, phase, agent }) => {
              const badge = phaseBadge(phase)
              const selected = selectedRow?.run.id === run.id
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    className={
                      selected
                        ? 'w-full rounded-md border border-border bg-muted px-3 py-2.5 text-left'
                        : 'w-full rounded-md border border-transparent px-3 py-2.5 text-left hover:bg-muted/70'
                    }
                    onClick={() => setSelectedId(run.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{run.agreedOffer.customerName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {run.agreedOffer.lane.from.locality} → {run.agreedOffer.lane.to.locality}
                          {agent
                            ? ` · ${
                                agent === 'carrier_finder'
                                  ? t('logistics.inbox.agentCarrierFinder')
                                  : t('logistics.inbox.agentLoadOptimizer')
                              }`
                            : ''}
                        </div>
                      </div>
                      {busy ? <Spinner size="sm" className="mt-0.5" /> : null}
                    </div>
                    <div className="mt-1.5">
                      <StatusBadge variant={badge.variant} appearance="light" dot>
                        {t(badge.key)}
                      </StatusBadge>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {selectedRow ? (
            <div className="space-y-4 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{selectedRow.run.agreedOffer.customerName}</h3>
                <StatusBadge variant={phaseBadge(selectedRow.phase).variant} appearance="light" dot>
                  {t(phaseBadge(selectedRow.phase).key)}
                </StatusBadge>
                {selectedRow.agent ? (
                  <span className="text-xs text-muted-foreground">
                    {selectedRow.agent === 'carrier_finder'
                      ? t('logistics.inbox.agentCarrierFinder')
                      : t('logistics.inbox.agentLoadOptimizer')}
                  </span>
                ) : null}
              </div>

              {/* Decision card first when pending */}
              {selectedRow.run.status === 'carrier_proposal_pending' &&
              selectedRow.run.carrierProposal ? (
                <div className="space-y-3 rounded-lg border border-status-warning-border bg-status-warning-bg/50 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold tracking-tight">
                      {t('logistics.inbox.hitlCarrier')}
                    </p>
                    {selectedRow.run.carrierProposal.priceEur != null ? (
                      <p className="text-sm font-medium tabular-nums">
                        {selectedRow.run.carrierProposal.priceEur} EUR
                      </p>
                    ) : null}
                  </div>
                  <p className="text-base font-medium leading-snug">
                    {selectedRow.run.carrierProposal.party?.companyName ??
                      selectedRow.run.carrierProposal.summary}
                  </p>
                  {selectedRow.run.carrierProposal.rationale ? (
                    <p className="text-sm leading-relaxed text-foreground/90">
                      {formatAgentProse(selectedRow.run.carrierProposal.rationale)}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {selectedRow.run.agreedOffer.lane.from.locality} →{' '}
                    {selectedRow.run.agreedOffer.lane.to.locality}
                    {selectedRow.run.carrierProposal.party
                      ? ` · ${selectedRow.run.carrierProposal.party.city}`
                      : ''}
                    {selectedRow.run.carrierProposal.source
                      ? ` · ${selectedRow.run.carrierProposal.source}`
                      : ''}
                  </p>
                  {selectedRow.run.carrierProposal.party ? (
                    <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">{t('logistics.inbox.carrier.contact')}</dt>
                        <dd>{selectedRow.run.carrierProposal.party.contactName}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t('logistics.inbox.carrier.phone')}</dt>
                        <dd>
                          <a
                            className="underline-offset-2 hover:underline"
                            href={`tel:${selectedRow.run.carrierProposal.party.phone.replace(/\s+/g, '')}`}
                          >
                            {selectedRow.run.carrierProposal.party.phone}
                          </a>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t('logistics.inbox.carrier.email')}</dt>
                        <dd>
                          <a
                            className="underline-offset-2 hover:underline"
                            href={`mailto:${selectedRow.run.carrierProposal.party.email}`}
                          >
                            {selectedRow.run.carrierProposal.party.email}
                          </a>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t('logistics.inbox.carrier.nip')}</dt>
                        <dd className="font-mono tabular-nums">
                          {selectedRow.run.carrierProposal.party.nip}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      disabled={selectedRow.busy}
                      onClick={() => void hitl(selectedRow.run.id, { action: 'approve-carrier' })}
                    >
                      {t('logistics.orchestration.approve')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={selectedRow.busy}
                      onClick={() => void hitl(selectedRow.run.id, { action: 'reject-carrier' })}
                    >
                      {t('logistics.orchestration.reject')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {selectedRow.run.status === 'backload_proposal_pending' &&
              selectedRow.run.backloadProposal ? (
                <div className="space-y-3 rounded-lg border border-status-warning-border bg-status-warning-bg/50 p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold tracking-tight">
                      {t('logistics.inbox.hitlBackload')}
                    </p>
                    <p className="text-sm font-medium tabular-nums">
                      net {selectedRow.run.backloadProposal.candidate.economics.netEur} EUR
                    </p>
                  </div>
                  <p className="text-base font-medium leading-snug">
                    {selectedRow.run.backloadProposal.candidate.summary}
                  </p>
                  {selectedRow.run.backloadProposal.evaluation ? (
                    <p className="text-sm leading-relaxed text-foreground/90">
                      {formatAgentProse(selectedRow.run.backloadProposal.evaluation)}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    fee {selectedRow.run.backloadProposal.candidate.economics.exchangeFeeEur} EUR ·
                    fit{' '}
                    {String(selectedRow.run.backloadProposal.candidate.economics.fitsFreeCapacity)}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      disabled={selectedRow.busy}
                      onClick={() => void hitl(selectedRow.run.id, { action: 'approve-backload' })}
                    >
                      {t('logistics.orchestration.approve')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={selectedRow.busy}
                      onClick={() => void hitl(selectedRow.run.id, { action: 'reject-backload' })}
                    >
                      {t('logistics.orchestration.reject')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {selectedRow.phase !== 'needs_you' ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  {selectedRow.busy || selectedRow.phase === 'agent_working' ? (
                    <Spinner size="sm" />
                  ) : null}
                  {t(phaseActivityKey(selectedRow.run.status))}
                  {effectiveScan?.status === 'scanning' ? (
                    <span>· {t('logistics.inbox.activity.scanningCorridor')}</span>
                  ) : null}
                </p>
              ) : null}

              <TransportRunMap
                route={selectedRow.run.route}
                truck={selectedRow.run.truck}
                scan={effectiveScan}
                from={selectedRow.run.agreedOffer.lane.from}
                to={selectedRow.run.agreedOffer.lane.to}
              />

              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t('logistics.orchestration.offer')}</dt>
                  <dd>
                    {selectedRow.run.agreedOffer.offerId} · {selectedRow.run.agreedOffer.quoteNetEur}{' '}
                    {selectedRow.run.agreedOffer.currencyCode}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('logistics.orchestration.lane')}</dt>
                  <dd>
                    {selectedRow.run.agreedOffer.lane.from.locality} →{' '}
                    {selectedRow.run.agreedOffer.lane.to.locality} ·{' '}
                    {selectedRow.run.agreedOffer.lane.weightT}t
                  </dd>
                </div>
                {selectedRow.run.truck ? (
                  <>
                    <div>
                      <dt className="text-muted-foreground">{t('logistics.orchestration.truck')}</dt>
                      <dd>
                        {selectedRow.run.truck.progressPct.toFixed(1)}% ·{' '}
                        {selectedRow.run.truck.alongRouteKm} km
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('logistics.inbox.truck.capacity')}</dt>
                      <dd>
                        {selectedRow.run.truck.usedWeightT}/{selectedRow.run.truck.maxWeightT} t ·{' '}
                        {selectedRow.run.truck.usedLdm}/{selectedRow.run.truck.maxLdm} ldm · free{' '}
                        {selectedRow.run.truck.freeWeightT}t / {selectedRow.run.truck.freeLdm} ldm
                      </dd>
                    </div>
                  </>
                ) : null}
                {selectedRow.run.backloadScan.status !== 'idle' ? (
                  <div>
                    <dt className="text-muted-foreground">{t('logistics.inbox.scan.radius')}</dt>
                    <dd>
                      {selectedRow.run.backloadScan.radiusKm} km ·{' '}
                      {selectedRow.run.backloadScan.candidatesCount}{' '}
                      {t('logistics.inbox.scan.candidates')}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {(selectedRow.run.status === 'in_transit' ||
                selectedRow.run.status === 'backload_proposal_pending') && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={selectedRow.busy}
                  onClick={() => void searchBackloadAgain(selectedRow.run)}
                >
                  {t('logistics.inbox.searchBackloadAgain')}
                </Button>
              )}

              {selectedRow.run.listing ? (
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t('logistics.inbox.listing.title')}
                  </summary>
                  <p className="mt-2 text-sm font-medium">{selectedRow.run.listing.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {selectedRow.run.listing.body}
                  </p>
                </details>
              ) : null}

              {selectedRow.run.agentLog?.length ? (
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {t('logistics.inbox.agentLog')}
                  </summary>
                  <ul className="mt-2 max-h-40 space-y-2 overflow-auto text-sm">
                    {selectedRow.run.agentLog.slice(0, 4).map((entry, idx) => (
                      <li key={`${entry.at}-${idx}`} className="rounded-md bg-muted/50 px-2 py-1.5">
                        <span className="font-medium">
                          {entry.agent === 'carrier_finder'
                            ? t('logistics.inbox.agentCarrierFinder')
                            : t('logistics.inbox.agentLoadOptimizer')}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{entry.at}</span>
                        <p className="mt-1 text-muted-foreground">
                          {formatAgentProse(entry.text, 220)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {selectedRow.run.history.length > 0 ? (
                <div>
                  <p className="mb-2 text-sm font-medium">{t('logistics.orchestration.history')}</p>
                  <ul className="max-h-72 space-y-2 overflow-auto">
                    {selectedRow.run.history.map((h, i) => (
                      <HistoryStep key={`${h.at}-${h.event}-${i}`} entry={h} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
