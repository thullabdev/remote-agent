import type { ReactNode } from 'react'

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{children}</p>
}
