import type { ReactNode } from 'react'

type TestColumn<RecordType> = {
  id?: string
  accessorKey?: keyof RecordType
  header?: ReactNode
  cell?: (context: { row: { original: RecordType } }) => ReactNode
}

type TestTableProps<RecordType> = {
  data: RecordType[]
  columns: TestColumn<RecordType>[]
  searchValue?: string
  searchPlaceholder?: string
  onSearchChange?: (value: string) => void
  emptyState?: ReactNode
}

export function DispatcherDataTable<RecordType extends { id: string }>({
  data, columns, searchValue, searchPlaceholder, onSearchChange, emptyState,
}: TestTableProps<RecordType>) {
  return (
    <>
      {onSearchChange ? <input placeholder={searchPlaceholder} value={searchValue} onChange={(event) => onSearchChange(event.target.value)} /> : null}
      <table>
        <thead><tr>{columns.map((column, index) => <th key={column.id ?? index}>{column.header}</th>)}</tr></thead>
        <tbody>{data.map((record) => (
          <tr key={record.id}>{columns.map((column, index) => (
            <td key={column.id ?? index}>{column.cell
              ? column.cell({ row: { original: record } })
              : column.accessorKey ? String(record[column.accessorKey]) : null}</td>
          ))}</tr>
        ))}</tbody>
      </table>
      {data.length === 0 ? emptyState : null}
    </>
  )
}
