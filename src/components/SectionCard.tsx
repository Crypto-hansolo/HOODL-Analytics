import type { ReactNode } from 'react'

interface SectionCardProps {
  title: string
  description?: string
  right?: ReactNode
  children: ReactNode
  flush?: boolean
}

export function SectionCard({ title, description, right, children, flush }: SectionCardProps) {
  return (
    <section className="section-card">
      <div className="section-card__header">
        <div>
          <div className="section-card__title">{title}</div>
          {description && <div className="section-card__desc">{description}</div>}
        </div>
        {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{right}</div>}
      </div>
      <div className={flush ? 'section-card__body section-card__body--flush' : 'section-card__body'}>{children}</div>
    </section>
  )
}
