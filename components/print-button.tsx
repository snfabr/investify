'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print text-sm text-gray-500 border border-gray-300 rounded px-3 py-1.5 hover:bg-gray-50"
    >
      Print / Save PDF
    </button>
  )
}
