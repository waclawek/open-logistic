"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { extensionPoints } from '../extension-points'
import type { CarrierStatus, TransportListResponse, TransportRow } from '../types'

const PAGE_SIZE = 25

function badgeVariant(status: string): StatusBadgeVariant {
  if (status === 'approved' || status === 'confirmed') return 'success'
  if (status === 'pending_approval') return 'warning'
  if (status === 'rejected' || status === 'cancelled') return 'error'
  return 'neutral'
}

function formatDateRange(start: string | null, end: string | null, locale: string): string {
  if (!start) return '—'
  const date = new Date(start)
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
  const startTime = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(date)
  if (!end) return `${day}, ${startTime}`
  const endTime = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(end))
  return `${day}, ${startTime}–${endTime}`
}

function formatMoney(value: number | null, currencyCode: string, locale: string): string {
  if (value == null) return '—'
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(value)
}

function formatCargo(pallets: number | null, kg: number | null): string {
  const parts = []
  if (pallets != null) parts.push(`${pallets} EP`)
  if (kg != null) parts.push(`${new Intl.NumberFormat().format(kg)} kg`)
  return parts.join(' — ') || '—'
}

export function TransportsTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const [loadedScope, setLoadedScope] = React.useState(scopeVersion)
  const [rows, setRows] = React.useState<TransportRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'carrierStatus',
      label: t('logistics.transports.filters.carrierStatus'),
      type: 'select',
      options: (['none', 'pending_approval', 'approved'] satisfies CarrierStatus[]).map((value) => ({
        value,
        label: t(`logistics.carrierStatus.${value}`),
      })),
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<TransportRow>[]>(() => [
    {
      accessorKey: 'orderNumber',
      header: t('logistics.transports.columns.order'),
      enableSorting: false,
      cell: ({ row }) => <Button asChild type="button" variant="link" className="px-0"><a href={`/backend/logistics/transports/${row.original.id}`}>{row.original.orderNumber}</a></Button>,
      meta: { sticky: true, priority: 1 },
    },
    {
      accessorKey: 'customerName',
      header: t('logistics.transports.columns.customer'),
      enableSorting: false,
      meta: { priority: 2 },
    },
    {
      id: 'route',
      header: t('logistics.transports.columns.route'),
      enableSorting: false,
      cell: ({ row }) => `${row.original.pickupAddress ?? '—'} → ${row.original.deliveryAddress ?? '—'}`,
      meta: { priority: 1 },
    },
    {
      accessorKey: 'pickupWindowStart',
      header: t('logistics.transports.columns.pickup'),
      cell: ({ row }) => formatDateRange(row.original.pickupWindowStart, row.original.pickupWindowEnd, locale),
      meta: { priority: 2 },
    },
    {
      id: 'cargo',
      header: t('logistics.transports.columns.cargo'),
      enableSorting: false,
      cell: ({ row }) => formatCargo(row.original.cargoPallets, row.original.cargoWeightKg),
      meta: { priority: 3 },
    },
    {
      accessorKey: 'clientPrice',
      header: t('logistics.transports.columns.clientPrice'),
      enableSorting: false,
      cell: ({ row }) => formatMoney(row.original.clientPrice, row.original.currencyCode, locale),
      meta: { priority: 4 },
    },
    {
      id: 'carrier',
      header: t('logistics.transports.columns.carrier'),
      enableSorting: false,
      cell: ({ row }) => row.original.carrier ? (
        <div className="flex flex-col items-start gap-1">
          <span>{row.original.carrier.name}</span>
          <StatusBadge variant={badgeVariant(row.original.carrier.status)} dot>
            {t(`logistics.status.${row.original.carrier.status}`)}
          </StatusBadge>
        </div>
      ) : <span className="text-muted-foreground">{t('logistics.carrierStatus.none')}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'additionalLoads',
      header: t('logistics.transports.columns.additionalLoads'),
      enableSorting: false,
      cell: ({ row }) => (
        <span>{row.original.additionalLoads.approved} / {row.original.additionalLoads.pending}</span>
      ),
      meta: { priority: 4 },
    },
    {
      id: 'freeSpace',
      header: t('logistics.transports.columns.freeSpace'),
      enableSorting: false,
      cell: ({ row }) => {
        const value = row.original.freeSpace
        if (!value) return <span className="text-muted-foreground">—</span>
        const overloaded = (value.pallets != null && value.pallets < 0) || (value.kg != null && value.kg < 0)
        return (
          <span className={overloaded ? 'font-semibold text-status-error-text' : undefined}>
            {formatCargo(value.pallets, value.kg)}
          </span>
        )
      },
      meta: { priority: 3 },
    },
  ], [t, locale])

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortField: sorting[0]?.id ?? 'updatedAt',
        sortDir: sorting[0]?.desc ? 'desc' : 'asc',
      })
      if (search.trim()) params.set('search', search.trim())
      if (typeof filters.carrierStatus === 'string' && filters.carrierStatus) {
        params.set('carrierStatus', filters.carrierStatus)
      }
      const call = await apiCallOrThrow<TransportListResponse>(
        `/api/logistics/transports?${params.toString()}`,
        { signal },
        { errorMessage: t('logistics.transports.errors.load') },
      )
      if (!call.result) throw new Error(t('logistics.transports.errors.load'))
      if (signal?.aborted) return
      setLoadedScope(scopeVersion)
      setRows(call.result.items)
      setTotal(call.result.total)
    } catch (loadError) {
      if (signal?.aborted || (loadError instanceof Error && loadError.name === 'AbortError')) return
      setError(loadError instanceof Error ? loadError.message : t('logistics.transports.errors.load'))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [filters.carrierStatus, page, search, sorting, t, scopeVersion])

  React.useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, reloadToken, scopeVersion])

  React.useEffect(() => setPage(1), [search, filters, scopeVersion])

  if (error && rows.length === 0 && !loading) {
    return (
      <ErrorMessage
        label={error}
        action={<Button type="button" size="sm" variant="outline" onClick={() => setReloadToken((value) => value + 1)}>{t('logistics.actions.retry')}</Button>}
      />
    )
  }

  return (
    <DataTable<TransportRow>
      extensionTableId={extensionPoints.hosts.transportsTable.tableId}
      title={(
        <div className="flex flex-col">
          <h1 className="text-base font-semibold">{t('logistics.transports.title')}</h1>
          <p className="text-sm font-normal text-muted-foreground">{t('logistics.transports.description')}</p>
        </div>
      )}
      columns={columns}
      data={loadedScope === scopeVersion ? rows : []}
      manualSorting
      sorting={sorting}
      onSortingChange={setSorting}
      isLoading={loading || loadedScope !== scopeVersion}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t('logistics.transports.search')}
      filters={filterDefs}
      filterValues={filters}
      onFiltersApply={setFilters}
      onFiltersClear={() => setFilters({})}
      pagination={{
        page,
        pageSize: PAGE_SIZE,
        total: loadedScope === scopeVersion ? total : 0,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        onPageChange: setPage,
      }}
      refreshButton={{
        label: t('logistics.actions.refresh'),
        onRefresh: () => setReloadToken((value) => value + 1),
        isRefreshing: loading,
      }}
      exporter={false}
      rowActions={(row) => (
        <RowActions items={[{
          id: 'open',
          label: t('logistics.actions.open'),
          href: `/backend/logistics/transports/${row.id}`,
        }]} />
      )}
      onRowClick={(row) => router.push(`/backend/logistics/transports/${row.id}`)}
      emptyState={(
        <EmptyState
          title={t('logistics.transports.empty.title')}
          description={t('logistics.transports.empty.description')}
          icon={<Truck className="size-5" />}
        />
      )}
    />
  )
}
