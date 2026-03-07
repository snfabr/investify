'use client'

import { useEffect } from 'react'

export function AutoPrint() {
  useEffect(() => {
    // Small delay to ensure the page is fully rendered before triggering print
    const t = setTimeout(() => window.print(), 800)
    return () => clearTimeout(t)
  }, [])
  return null
}
