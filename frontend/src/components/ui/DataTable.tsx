import { useMemo, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Value used for sorting; omit to make the column unsortable. */
  sortValue?: (row: T) => number | string | null
  numeric?: boolean
  title?: string
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  pageSize?: number
  rowClassName?: (row: T) => string | undefined
  onRowClick?: (row: T) => void
  caption: string
  emptyMessage?: string
}

const PAGE_SIZES = [12, 24, 48, 96]

/** Sortable, paginated table. Sorting/pagination are client-side because each view's rows are already bounded by the API. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  pageSize: initialPageSize = 24,
  rowClassName,
  onRowClick,
  caption,
  emptyMessage = 'No rows match the current filters.',
}: Props<T>) {
  const [sort, setSort] = useState(initialSort)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key)
    if (!sort || !col?.sortValue) return rows
    const get = col.sortValue
    const dir = sort.dir === 'asc' ? 1 : -1
    // Nulls always sort last regardless of direction.
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return va < vb ? -dir : va > vb ? dir : 0
    })
  }, [rows, columns, sort])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize)

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
    setPage(0)
  }

  return (
    <div>
      <div className="table-wrap">
        <table className="data">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined
                return (
                  <th key={c.key} className={c.numeric ? 'num' : undefined} aria-sort={ariaSort} title={c.title} scope="col">
                    {c.sortValue ? (
                      <button type="button" onClick={() => toggleSort(c.key)}>
                        {c.header}
                        <Icon name={active ? (sort!.dir === 'asc' ? 'up' : 'down') : 'sort'} size={12} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="muted" style={{ textAlign: 'center', padding: 28 }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={[rowClassName?.(row), onRowClick ? 'row-clickable' : ''].filter(Boolean).join(' ') || undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.numeric ? 'num' : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE_SIZES[0] && (
        <div className="pager">
          <span className="tabular">
            {current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} of {sorted.length.toLocaleString('en-GB')}
          </span>
          <div className="pager-controls">
            <label className="row" style={{ gap: 6 }}>
              <span>Rows</span>
              <select
                className="select"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value))
                  setPage(0)
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn icon-btn"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              aria-label="Previous page"
            >
              <Icon name="chevronLeft" />
            </button>
            <span className="tabular">
              Page {current + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn icon-btn"
              onClick={() => setPage(current + 1)}
              disabled={current >= pageCount - 1}
              aria-label="Next page"
            >
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
