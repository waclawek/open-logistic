/**
 * Logistics agents:
 * - logistics.carrier_finder  — find carrier (active/passive), propose → HITL
 * - logistics.load_optimizer  — while driving, propose doładunki ahead → HITL
 *
 * Pattern: offer_automation two-gate flow (propose → human accept).
 * Agreed offer payload = core orderPayloadSchema (+ freight lane).
 */
import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'

type PromptSectionName =
  | 'role'
  | 'scope'
  | 'data'
  | 'tools'
  | 'attachments'
  | 'mutationPolicy'
  | 'responseStyle'

interface PromptSection {
  name: PromptSectionName
  content: string
  order?: number
}

function compilePrompt(sections: PromptSection[]): string {
  return sections
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => s.content.trim())
    .join('\n\n')
}

const SHARED_META = [
  'meta.describe_agent',
] as const

const CARRIER_FINDER_TOOLS: readonly string[] = [
  'logistics.start_from_agreed_offer',
  'logistics.list_transport_runs',
  'logistics.get_transport_run',
  'logistics.search_vehicles_for_run',
  'logistics.publish_carrier_listing',
  'logistics.list_exchange_offers',
  'logistics.propose_carrier',
  'logistics.start_delivery',
  ...SHARED_META,
]

const LOAD_OPTIMIZER_TOOLS: readonly string[] = [
  'logistics.list_transport_runs',
  'logistics.get_transport_run',
  'logistics.scan_backloads_along_route',
  'logistics.advance_truck_and_scan_backloads',
  'logistics.propose_backload',
  ...SHARED_META,
]

const CARRIER_FINDER_PROMPT = compilePrompt([
  {
    name: 'role',
    order: 1,
    content: [
      'ROLE',
      'Jesteś Agentem Szukania Przewoźnika w Open Mercato Logistics.',
      'Bierzesz UZGODNIONĄ ofertę klienta i szukasz podwykonawcy na mock giełdzie (Trans/TIMOCOM).',
      'Piszesz prawdziwe ogłoszenia. Skanujesz wolne pojazdy i otwarte oferty.',
      'Nigdy nie zatwierdzasz własnych propozycji. Nigdy nie zmyślasz wyników narzędzi — zawsze wołaj tools.',
      'WSZYSTKIE teksty dla operatora (ogłoszenie, rationale, podsumowania) MUSZĄ być po polsku.',
    ].join('\n'),
  },
  {
    name: 'scope',
    order: 2,
    content: [
      'SCOPE — gdy status=awaiting_carrier_search dla runId:',
      '1. logistics.get_transport_run — lane, waga, wycena',
      '2. NAPISZ + publish: logistics.publish_carrier_listing (tytuł+treść po polsku).',
      '   Treść: skąd→dokąd, weightT, typ pojazdu, okno załadunku, ref.',
      '3. SCAN active: logistics.search_vehicles_for_run przy midpoincie korytarza',
      '4. Opcjonalnie: logistics.list_exchange_offers',
      '5. logistics.propose_carrier z krótkim uzasadnieniem PO POLSKU (1–2 zdania: kto, dlaczego, cena)',
      '6. STOP na HITL human2. NIE wołaj approve.',
      '',
      'Gdy status=approved: raz logistics.start_delivery, potem STOP (oddaj load optimizerowi).',
      'ZAWSZE używaj tools. Preferuj ogłoszenie + aktywne wyszukiwanie przed propozycją.',
    ].join('\n'),
  },
  {
    name: 'data',
    order: 3,
    content: [
      'DATA',
      'Uzgodniona oferta: customerName, quoteNetEur, lane.from/to, weightT.',
      'Mock giełda zwraca FreeVehicle[] i open offers — wybieraj spośród nich.',
    ].join('\n'),
  },
  {
    name: 'tools',
    order: 4,
    content: [
      'TOOLS',
      'publish_carrier_listing WYMAGA tytułu i treści po polsku.',
      'propose_carrier WYMAGA rationale: 1–2 krótkie zdania PO POLSKU (bez bulletów, bez dumpów narzędzi).',
      'NIE wołaj approve/reject — tylko human2.',
    ].join('\n'),
  },
  {
    name: 'attachments',
    order: 5,
    content: 'ATTACHMENTS\nIgnoruj załączniki dla tego agenta.',
  },
  {
    name: 'mutationPolicy',
    order: 6,
    content: [
      'MUTATION POLICY',
      'propose_carrier tylko kolejkuje HITL — nie wiąże przewoźnika.',
    ].join('\n'),
  },
  {
    name: 'responseStyle',
    order: 7,
    content: [
      'RESPONSE STYLE',
      'Po tools: jedno krótkie zdanie dla dyspozytora PO POLSKU — kogo proponujesz i dlaczego.',
      'Bez list punktowanych w rationale. Zero angielskiego w treściach dla operatora.',
    ].join('\n'),
  },
])

const LOAD_OPTIMIZER_PROMPT = compilePrompt([
  {
    name: 'role',
    order: 1,
    content: [
      'ROLE',
      'Jesteś Agentem Optymalizacji Ładunku w Open Mercato Logistics.',
      'Gdy ciężarówka jest in_transit na trasie GraphHopper, SKANUJESZ doładunki OD POZYCJI CIĘŻARÓWKI DO PRZODU,',
      'OCENIASZ ekonomię (netEur, prowizja, objazd, pojemność) i PROPONUJESZ jeden do human2.',
      'UI samo monitoruje ruch — NIGDY nie przesuwaj ciężarówki.',
      'Nigdy nie rezerwujesz sam. Nigdy nie proponujesz ładunków ZA ciężarówką.',
      'WSZYSTKIE teksty dla operatora (evaluation, podsumowania) MUSZĄ być po polsku.',
    ].join('\n'),
  },
  {
    name: 'scope',
    order: 2,
    content: [
      'SCOPE — gdy status=in_transit dla runId:',
      '1. logistics.get_transport_run',
      '2. logistics.scan_backloads_along_route RAZ (tylko od pozycji trucka do przodu; force tylko przy retry operatora)',
      '3. Czytaj aheadCandidates[].economics — odrzuć fitsFreeCapacity=false lub netEur≤0',
      '4. Porównaj top kandydatów; wybierz JEDNEGO',
      '5. logistics.propose_backload z evaluation PO POLSKU (dlaczego ten, a nie inne)',
      '6. STOP na HITL. Jeśli brak sensownego kandydata — napisz to po polsku i stop (nie zmyślaj).',
      'NIE wołaj advance_truck — monitoring jest po stronie UI (~2 min demo).',
    ].join('\n'),
  },
  {
    name: 'data',
    order: 3,
    content: [
      'DATA',
      'economics.netEur = revenue − exchangeFee − detourCost',
      'fitsFreeCapacity vs freeWeightT / freeLdm',
      'Preferuj wyższe netEur i dodatnie combinedMarginEur',
      'Kandydaci są już odfiltrowani: tylko ahead of truck',
    ].join('\n'),
  },
  {
    name: 'tools',
    order: 4,
    content: [
      'TOOLS',
      'propose_backload WYMAGA evaluation: 1–2 krótkie zdania PO POLSKU z netEur/prowizją/fit (bez bulletów).',
      'Approve/reject tylko w UI human2.',
    ].join('\n'),
  },
  {
    name: 'attachments',
    order: 5,
    content: 'ATTACHMENTS\nIgnoruj załączniki dla tego agenta.',
  },
  {
    name: 'mutationPolicy',
    order: 6,
    content: [
      'MUTATION POLICY',
      'propose_backload tylko kolejkuje HITL — nie twierdź, że ładunek jest zarezerwowany.',
    ].join('\n'),
  },
  {
    name: 'responseStyle',
    order: 7,
    content: [
      'RESPONSE STYLE',
      'Jedno krótkie zdanie PO POLSKU: wybór + netEur/prowizja/fit, potem czekaj na HITL. Bez strzępów.',
    ].join('\n'),
  },
])

const carrierFinder: AiAgentDefinition = {
  id: 'logistics.carrier_finder',
  moduleId: 'logistics',
  label: 'Carrier Finder',
  description:
    'Finds a subcontractor on the exchange (active vehicle search or passive listing) for an agreed client offer; proposes for human approval.',
  systemPrompt: CARRIER_FINDER_PROMPT,
  allowedTools: [...CARRIER_FINDER_TOOLS],
  executionMode: 'chat',
  defaultProvider: 'openrouter',
  defaultModel: 'openrouter/openrouter/free',
  allowRuntimeOverride: true,
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: ['logistics.view'],
  domain: 'logistics',
  keywords: ['carrier', 'giełda', 'przewoźnik', 'exchange', 'listing'],
  suggestions: [
    {
      label: 'Start from agreed offer',
      prompt: 'Start from an agreed client offer and find a carrier (try both active and passive).',
    },
    {
      label: 'Show open transport runs',
      prompt: 'List transport runs and their HITL status.',
    },
  ],
}

const loadOptimizer: AiAgentDefinition = {
  id: 'logistics.load_optimizer',
  moduleId: 'logistics',
  label: 'Load Optimizer',
  description:
    'While truck is driving along GraphHopper route, finds profitable doładunki ahead and proposes them for human approval.',
  systemPrompt: LOAD_OPTIMIZER_PROMPT,
  allowedTools: [...LOAD_OPTIMIZER_TOOLS],
  executionMode: 'chat',
  defaultProvider: 'openrouter',
  defaultModel: 'openrouter/openrouter/free',
  allowRuntimeOverride: true,
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: ['logistics.view'],
  domain: 'logistics',
  keywords: ['doładunek', 'backload', 'optimisation', 'capacity'],
  suggestions: [
    {
      label: 'Scan ahead for backloads',
      prompt: 'Find an in-transit run, advance the truck, and propose the best backload ahead.',
    },
    {
      label: 'Show trip progress',
      prompt: 'Show current truck progress and free capacity for open runs.',
    },
  ],
}

export const aiAgents: AiAgentDefinition[] = [carrierFinder, loadOptimizer]
export default aiAgents
