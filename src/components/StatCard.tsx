import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  badge?: ReactNode
}

export function StatCard({ label, value, sub, badge }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__label">
        <span>{label}</span>
        {badge}
      </div>
      <div className="stat-card__value">{value}</div>
      {sub && <div className="stat-card__sub">{sub}</div>}
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="stat-card">
      <div className="skeleton" style={{ width: '60%', height: 10, marginBottom: 10 }} />
      <div className="skeleton" style={{ width: '80%', height: 20 }} />
    </div>
  )
}
