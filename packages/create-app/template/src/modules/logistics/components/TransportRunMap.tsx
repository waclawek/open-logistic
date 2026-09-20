'use client'

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import 'leaflet/dist/leaflet.css'
import type { LogisticsRoute } from '../lib/types'
import type { BackloadScanState, TruckPosition } from '../lib/transport-run-model'

export type TransportRunMapProps = {
  route: LogisticsRoute | null
  truck: TruckPosition | null
  scan: BackloadScanState | null
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
}

type TransportRunMapComponent = (props: TransportRunMapProps) => React.ReactElement

/**
 * Lazy shell around Leaflet JS. CSS is imported here (safe on SSR); the JS impl is loaded
 * client-side only because Leaflet touches `window` at import time.
 */
export function TransportRunMap(props: TransportRunMapProps): React.ReactElement {
  const [Impl, setImpl] = React.useState<TransportRunMapComponent | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void import('./TransportRunMapImpl').then((mod) => {
      if (!cancelled) setImpl(() => mod.default)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!Impl) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-border bg-muted/30">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }

  return <Impl {...props} />
}

export default TransportRunMap
