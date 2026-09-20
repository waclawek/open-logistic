import { splitInbox, type InboxAction, type InboxProposalSummary } from '../lib/inbox-board'

function proposal(overrides: Partial<InboxProposalSummary> & { id: string }): InboxProposalSummary {
  return {
    summary: 'Summary',
    category: 'rfq',
    status: 'pending',
    confidence: '0.9',
    emailSubject: 'Subject',
    emailFrom: 'Anna Kowalska',
    receivedAt: '2026-09-20T07:00:00.000Z',
    ...overrides,
  }
}

function action(overrides: Partial<InboxAction> & { id: string; actionType: string }): InboxAction {
  return { status: 'pending', description: '', confidence: '0.95', payload: {}, ...overrides }
}

describe('AI inbox board split', () => {
  test('puts draft replies left and quotes right, from the same proposal', () => {
    const rfq = proposal({ id: 'p1', emailSubject: 'RFQ: Gdańsk to Berlin' })
    const board = splitInbox([rfq], {
      p1: [
        action({
          id: 'a1',
          actionType: 'create_quote',
          payload: {
            customerName: 'Baltic Paper',
            customerEmail: 'anna@baltic.example',
            currencyCode: 'EUR',
            lineItems: [{ productName: 'Road freight Gdańsk–Berlin', quantity: '1', unitPrice: '1200' }],
            transport: { pickupAddress: 'Gdańsk', deliveryAddress: 'Berlin', cargoPallets: 10, cargoWeightKg: 6000 },
          },
        }),
        action({ id: 'a2', actionType: 'draft_reply', payload: { to: 'anna@baltic.example', toName: 'Anna', subject: 'Re: RFQ', body: 'Thank you' } }),
      ],
    })
    expect(board.offers).toHaveLength(1)
    expect(board.offers[0]).toMatchObject({
      proposalId: 'p1',
      actionId: 'a1',
      customerName: 'Baltic Paper',
      currencyCode: 'EUR',
      total: 1200,
      confidence: 95,
      transport: { pickupAddress: 'Gdańsk', deliveryAddress: 'Berlin', cargoPallets: 10, cargoWeightKg: 6000 },
    })
    expect(board.replies).toHaveLength(1)
    expect(board.replies[0]).toMatchObject({ actionId: 'a2', toName: 'Anna', subject: 'Re: RFQ', body: 'Thank you' })
    expect(board.others).toEqual([])
  })

  test('skips non-pending actions and proposals whose actions are not loaded yet', () => {
    const board = splitInbox([proposal({ id: 'p1' }), proposal({ id: 'p2' })], {
      p1: [action({ id: 'a1', actionType: 'create_quote', status: 'executed', payload: { customerName: 'X', currencyCode: 'EUR' } })],
    })
    expect(board.offers).toEqual([])
    expect(board.replies).toEqual([])
    expect(board.others).toEqual([])
  })

  test('collects other pending work per proposal and sorts newest first', () => {
    const board = splitInbox(
      [
        proposal({ id: 'old', receivedAt: '2026-09-20T05:00:00.000Z', category: 'complaint' }),
        proposal({ id: 'new', receivedAt: '2026-09-20T09:00:00.000Z', category: 'shipping_update' }),
      ],
      {
        old: [action({ id: 'a1', actionType: 'log_activity' }), action({ id: 'a2', actionType: 'draft_reply', payload: { body: 'Sorry' } })],
        new: [action({ id: 'a3', actionType: 'update_shipment' })],
      },
    )
    expect(board.others.map((card) => card.proposalId)).toEqual(['new', 'old'])
    expect(board.others[1].pendingActionTypes).toEqual(['log_activity'])
    expect(board.replies).toHaveLength(1)
  })

  test('treats the priced draft_offer action as an offer and leaves total empty without prices', () => {
    const board = splitInbox([proposal({ id: 'p1' })], {
      p1: [action({ id: 'a1', actionType: 'draft_offer', payload: { customerName: 'Amber Home', currencyCode: 'PLN', lineItems: [{ productName: 'Freight', quantity: '2' }] } })],
    })
    expect(board.offers[0]).toMatchObject({ actionType: 'draft_offer', currencyCode: 'PLN', total: null, transport: null })
    expect(board.offers[0].lines).toEqual([{ name: 'Freight', quantity: 2, unitPrice: null }])
  })
})
