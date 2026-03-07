'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileText, Zap, ChevronDown, ChevronUp, Printer } from 'lucide-react'
import type { HistoryEntry, PortfolioImport, ActionSession } from '@/app/(app)/history/page'

interface RecommendedAction {
  action: string
  symbol?: string | null
  rationale: string
  amount_gbp?: number | null
}

interface Recommendation {
  objective?: string
  analysis?: string
  recommended_actions?: RecommendedAction[]
  risks?: string
  next_steps?: string
  disclaimer?: string
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtGbp(v: number) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(v)
}

function ImportEntry({ data }: { data: PortfolioImport }) {
  return (
    <div className="flex items-start gap-4">
      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
        <FileText className="h-4 w-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">Portfolio Import</span>
          <Badge
            variant="outline"
            className={data.status === 'success' ? 'text-green-600' : 'text-amber-600'}
          >
            {data.status}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground truncate">{data.filename}</p>
        {data.rows_imported != null && (
          <p className="text-xs text-muted-foreground">{data.rows_imported} holdings imported</p>
        )}
        <a href="/portfolio" className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
          View portfolio →
        </a>
      </div>
      <span className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(data.created_at)}</span>
    </div>
  )
}

function ActionEntry({ data }: { data: ActionSession }) {
  const [expanded, setExpanded] = useState(false)
  const rec = data.recommendation as Recommendation | null

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-4">
        <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
          <Zap className="h-4 w-4 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{data.title}</span>
            <Badge variant="secondary">Action Session</Badge>
          </div>
          {data.summary && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{data.summary}</p>
          )}
          {rec && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 mt-1 text-xs"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? (
                <><ChevronUp className="h-3 w-3 mr-1" />Hide details</>
              ) : (
                <><ChevronDown className="h-3 w-3 mr-1" />View details</>
              )}
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(data.created_at)}</span>
      </div>

      {expanded && rec && (
        <div className="ml-12 space-y-3 border-l-2 border-muted pl-4">
          {rec.analysis && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Analysis</p>
              <p className="text-sm">{rec.analysis}</p>
            </div>
          )}

          {(rec.recommended_actions || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Recommended Actions</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1.5 font-medium">Action</th>
                      <th className="text-left py-1.5 font-medium">Symbol</th>
                      <th className="text-left py-1.5 font-medium">Rationale</th>
                      <th className="text-right py-1.5 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rec.recommended_actions || []).map((a, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5">
                          <Badge variant="outline" className="capitalize text-xs">{a.action}</Badge>
                        </td>
                        <td className="py-1.5 font-mono text-xs">{a.symbol || '—'}</td>
                        <td className="py-1.5 text-xs">{a.rationale}</td>
                        <td className="py-1.5 text-right text-xs">
                          {a.amount_gbp ? fmtGbp(a.amount_gbp) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {rec.risks && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Risks</p>
              <p className="text-sm">{rec.risks}</p>
            </div>
          )}

          {rec.next_steps && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Next Steps</p>
              <p className="text-sm">{rec.next_steps}</p>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => window.print()}
          >
            <Printer className="h-3 w-3 mr-1" />
            Print
          </Button>

          {rec.disclaimer && (
            <p className="text-xs text-muted-foreground italic">{rec.disclaimer}</p>
          )}
        </div>
      )}
    </div>
  )
}

interface HistoryViewProps {
  entries: HistoryEntry[]
}

export function HistoryView({ entries }: HistoryViewProps) {
  if (entries.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">History</h1>
          <p className="text-muted-foreground">Your portfolio imports and advisory sessions.</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No history yet.</p>
            <p className="text-sm mt-1">Import a portfolio CSV or start an Action session to see entries here.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">History</h1>
        <p className="text-muted-foreground">Your portfolio imports and advisory sessions.</p>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => (
          <Card key={`${entry.type}-${entry.data.id}`}>
            <CardContent className="py-4">
              {entry.type === 'import' ? (
                <ImportEntry data={entry.data as PortfolioImport} />
              ) : (
                <ActionEntry data={entry.data as ActionSession} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
