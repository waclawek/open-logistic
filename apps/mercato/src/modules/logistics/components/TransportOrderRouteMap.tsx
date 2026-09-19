'use client'

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import 'leaflet/dist/leaflet.css'
import type { LogisticsOrder } from '../lib/types'

export type TransportOrderRouteMapProps = {
  order: LogisticsOrder
}

type RouteMapComponent = (props: TransportOrderRouteMapProps) => React.ReactElement

/** Client-only Leaflet shell — see TransportRunMap. */
export function TransportOrderRouteMap(props: TransportOrderRouteMapProps): React.ReactElement {
  const [Impl, setImpl] = React.useState<RouteMapComponent | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void import('./TransportOrderRouteMapImpl').then((mod) => {
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
