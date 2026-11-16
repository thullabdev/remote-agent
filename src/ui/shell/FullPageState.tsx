import type { ReactNode } from 'react'

/** A whole-screen message: connecting, a failure, or access denied. Each one offers the action that helps, if any. */
export function FullPageState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return (
    <main className="grain flex h-full items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-3xl bg-card p-7 text-center shadow-sm sm:p-9">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">{icon}</div>
        <h1 className="mt-5 font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{detail}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </main>
  )
}
