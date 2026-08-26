import type { ReactNode } from 'react'

export function Callout({ kind = 'info', children }: { kind?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={`callout callout--${kind}`}>
      <span>{kind === 'warning' ? '⚠️' : 'ℹ️'}</span>
      <div>{children}</div>
    </div>
  )
}
