/**
 * What one extraction run produced, read back off the rows it wrote.
 *
 * In the source module this type lived in `lib/liveExtraction.ts`, next to the
 * two CLI-only modes that drive core's own extraction worker by hand. Those
 * modes are not ported: this repo's demo runs the production path (webhook,
 * event, subscriber), so there is nothing left to drive by hand. The type
 * stayed because `runFreightExtraction` returns it and `offers-send-email`
 * prints it.
 */

export type ExtractedActionRow = {
  id: string
  actionType: string
  status: string
  confidence: string | null
  payload: Record<string, unknown> | null
}

export type FreightExtractionOutcome = {
  /** Always `app`: the only extraction this module performs is its own. */
  mode: 'app'
  /** `processed`, `needs_review`, `failed`, or still `received` on a timeout. */
  emailStatus: string
  processingError: string | null
  proposalId: string | null
  proposalSummary: string | null
  proposalConfidence: string | null
  /** Model actually used, e.g. `openai/gpt-5-mini`. Never a key. */
  llmModel: string | null
  llmTokensUsed: number | null
  actions: ExtractedActionRow[]
  waitedMs: number
  /** Kept for shape compatibility with the source; this path never times out. */
  timedOut: boolean
}
