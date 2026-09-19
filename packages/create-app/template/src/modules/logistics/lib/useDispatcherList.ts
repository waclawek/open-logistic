'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type ListResult<Item> = { items: Item[]; total: number; page: number; totalPages: number }

export function useDispatcherList<Item extends { id: string }>(resource: 'offers' | 'transports', available = false, enabled = true) {
  const scopeVersion = useOrganizationScopeVersion()
  const [data, setData] = React.useState<ListResult<Item> & { scopeVersion: number }>({ items: [], total: 0, page: 1, totalPages: 1, scopeVersion })
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(enabled)
  const [failed, setFailed] = React.useState(false)
  const [revision, reload] = React.useReducer((value: number) => value + 1, 0)
  const pageSize = 10

  React.useEffect(() => {
    if (!enabled) return
    let active = true
    setLoading(true)
    setFailed(false)
    setData((current) => current.scopeVersion === scopeVersion ? current : { items: [], total: 0, page: 1, totalPages: 1, scopeVersion })
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search })
    if (available) query.set('available', 'true')
    void readApiResultOrThrow<ListResult<Item>>(`/api/logistics/${resource}?${query}`)
      .then((result) => {
        if (!active) return
        setData({ ...result, scopeVersion })
        if (page > Math.max(1, result.totalPages)) setPage(Math.max(1, result.totalPages))
      })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [resource, available, enabled, page, search, revision, scopeVersion])

  React.useEffect(() => { setPage(1); setSearch('') }, [scopeVersion])

  const changeSearch = (value: string) => { setSearch(value); setPage(1) }
  const replaceItem = (item: Item) => setData((current) => ({
    ...current,
    items: current.items.map((existing) => existing.id === item.id ? item : existing),
  }))

  return {
    ...data,
    items: data.scopeVersion === scopeVersion ? data.items : [],
    total: data.scopeVersion === scopeVersion ? data.total : 0,
    search, loading: loading || data.scopeVersion !== scopeVersion, failed, reload, replaceItem, changeSearch,
    pagination: { page, pageSize, total: data.scopeVersion === scopeVersion ? data.total : 0, totalPages: data.scopeVersion === scopeVersion ? data.totalPages : 1, onPageChange: setPage },
  }
}
