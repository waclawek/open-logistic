import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { runAiAgentText } from '@open-mercato/ai-assistant'
import type { UIMessage } from 'ai'
import {
  appendAgentLog,
  getTransportRun,
  maybeEscalateAgentStage,
  toTransportRunView,
  type TransportRun,
  type TransportRunStatus,
} from '../../../../lib/transport-run'
import { DEMO_STAGE_BUDGET_MS } from '../../../../lib/transport-run-model'
import { resolveLogisticsRequestContext } from '../../../../lib/request-context'
import { logisticsResponse } from '../../../response'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

type Ctx = { params: Promise<{ id: string }> }

function pickAgent(
  status: TransportRunStatus,
  run: TransportRun,
): { agentId: string; label: 'carrier_finder' | 'load_optimizer'; prompt: string } | null {
  if (status === 'awaiting_carrier_search') {
    return {
      agentId: 'logistics.carrier_finder',
      label: 'carrier_finder',
      prompt: [
        'Tick w tle dla transport run. Status: awaiting_carrier_search.',
        '1) get_transport_run dla tego runId',
        '2) NAPISZ ogłoszenie po polsku i publish_carrier_listing (tytuł + treść)',
        '3) search_vehicles_for_run (skan giełdy)',
        '4) opcjonalnie list_exchange_offers',
        '5) propose_carrier z krótkim uzasadnieniem PO POLSKU (1–2 zdania, bez bulletów) — potem STOP na HITL',
        'Nie zatwierdzaj. Wołaj tools teraz. Wszystkie odpowiedzi dla operatora po polsku.',
      ].join('\n'),
    }
  }
  if (status === 'approved') {
    return {
      agentId: 'logistics.carrier_finder',
      label: 'carrier_finder',
      prompt: [
        'Tick w tle. Status: approved (człowiek zaakceptował przewoźnika).',
        'Wołaj logistics.start_delivery dla tego runId, potem STOP (oddaj load optimizerowi).',
        'Komunikaty po polsku.',
      ].join('\n'),
    }
  }
  if (status === 'in_transit' && run.backloadScan.status === 'idle') {
    return {
      agentId: 'logistics.load_optimizer',
      label: 'load_optimizer',
      prompt: [
        'Tick w tle. Status: in_transit. Ruch ciężarówki monitoruje UI — NIE przesuwaj trucka.',
        '1) get_transport_run',
        '2) scan_backloads_along_route RAZ — TYLKO od pozycji ciężarówki do przodu (nie za nią)',
        '3) Oceń aheadCandidates (netEur, prowizja, pojemność, objazd)',
        '4) Jeśli jest sensowny kandydat: propose_backload z krótką oceną PO POLSKU — potem STOP na HITL',
        '5) Jeśli brak: napisz to po polsku i stop (nie zmyślaj).',
        'Wołaj tools teraz. Wszystkie odpowiedzi dla operatora po polsku.',
      ].join('\n'),
    }
  }
  return null
}

function extractDataPayload(eventBlock: string): string | null {
  const dataLines = eventBlock
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => (line.startsWith('data: ') ? line.slice(6) : line.slice(5)))
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

function extractAssistantText(raw: string, contentType: string | null): string {
  if (!contentType?.includes('event-stream')) return raw.trim()
  let content = ''
  for (const block of raw.split('\n\n')) {
    const data = extractDataPayload(block)
    if (!data || data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>
      if (parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
        content += parsed.delta
      } else if (parsed.type === 'text' && typeof parsed.text === 'string') {
        content += parsed.text
      }
    } catch {
      // ignore non-JSON chunks
    }
  }
  return content.trim()
}

export async function POST(req: Request, ctx: Ctx) {
  return logisticsResponse(async () => {
    const { container, scope } = await resolveLogisticsRequestContext(req)
    const { id } = await ctx.params
    const run = getTransportRun(id, scope)
    if (!run) return Response.json({ error: 'not_found' }, { status: 404 })

    const body = (await readJsonSafe<{ stageElapsedMs?: number; force?: boolean }>(req, {})) ?? {}
    const clientElapsed =
      typeof body.stageElapsedMs === 'number' && Number.isFinite(body.stageElapsedMs)
        ? Math.max(0, body.stageElapsedMs)
        : undefined

    // Hard overdue: skip LLM and finish the stage deterministically.
    const pre = maybeEscalateAgentStage(id, {
      elapsedMs: clientElapsed,
      force: body.force === true || (clientElapsed != null && clientElapsed >= DEMO_STAGE_BUDGET_MS),
    })
    if (pre.forced) {
      return Response.json({
        skipped: false,
        forced: true,
        reason: 'stage_budget',
        elapsedMs: pre.elapsedMs,
        stage: pre.stage,
        agent: pre.stage === 'backload_scan' ? 'load_optimizer' : 'carrier_finder',
        run: toTransportRunView(pre.run),
      })
    }

    const pick = pickAgent(pre.run.status, pre.run)
    if (!pick) {
      return Response.json({
        skipped: true,
        reason: 'waiting_for_hitl_or_done',
        status: pre.run.status,
        run: toTransportRunView(pre.run),
      })
    }

    const auth = await getAuthFromCookies()
    if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const rbac = container.resolve('rbacService') as RbacService
    const acl = await rbac.loadAcl(auth.sub, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })

    const userMessage: UIMessage = {
      id: `tick-${Date.now()}`,
      role: 'user',
      parts: [
        {
          type: 'text',
          text: [
            pick.prompt,
            '',
            `runId=${id}`,
            `stageElapsedMs=${clientElapsed ?? pre.elapsedMs}`,
            `stageBudgetMs=${DEMO_STAGE_BUDGET_MS}`,
            'Dokończ ten etap w tej turze jeśli możesz — operator nie powinien czekać dłużej niż ~30–40 s.',
            'Wszystkie teksty dla operatora (rationale, evaluation, notatki) MUSZĄ być po polsku.',
            'Doładunki: tylko od pozycji ciężarówki do przodu.',
          ].join('\n'),
        },
      ],
    } as UIMessage

    let agentText = ''
    try {
      const response = await runAiAgentText({
        agentId: pick.agentId,
        messages: [userMessage],
        pageContext: {
          view: 'logistics.proposals.agent_tick',
          recordType: 'logistics.transport_run',
          recordId: id,
        },
        authContext: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: auth.sub,
          features: acl.features ?? [],
          isSuperAdmin: acl.isSuperAdmin === true,
        },
        container,
        sessionId: null,
      })
      const raw = await response.text()
      agentText = extractAssistantText(raw, response.headers.get('content-type'))
    } catch (err) {
      // LLM failed — still try escalation so the stage can finish.
      const fallback = maybeEscalateAgentStage(id, {
        elapsedMs: clientElapsed,
        force: true,
      })
      return Response.json(
        {
          error: 'agent_failed',
          message: err instanceof Error ? err.message : String(err),
          forced: fallback.forced,
          run: toTransportRunView(fallback.run),
        },
        { status: fallback.forced ? 200 : 502 },
      )
    }

    let nextRun: TransportRun | null = getTransportRun(id, scope)
    if (nextRun && agentText) {
      nextRun = appendAgentLog(id, pick.label, agentText)
    }

    // After LLM: if stage still open, escalate with rising probability / hard budget.
    const post = maybeEscalateAgentStage(id, { elapsedMs: clientElapsed })
    nextRun = post.run

    return Response.json({
      skipped: false,
      forced: post.forced,
      elapsedMs: post.elapsedMs,
      stage: post.stage,
      agentId: pick.agentId,
      agent: pick.label,
      agentText,
      run: toTransportRunView(nextRun),
    })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsTransportRuns',
  methods: {
    POST: {
      summary: 'Run one logistics LLM agent step for a transport run (mock exchange tools)',
      tags: ['Logistics'],
    },
  },
}
