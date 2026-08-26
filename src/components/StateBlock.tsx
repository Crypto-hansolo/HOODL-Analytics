interface StateBlockProps {
  icon?: string
  title: string
  description?: string
}

export function StateBlock({ icon = 'ℹ️', title, description }: StateBlockProps) {
  return (
    <div className="state-block">
      <div className="state-block__icon">{icon}</div>
      <div className="state-block__title">{title}</div>
      {description && <div className="state-block__desc">{description}</div>}
    </div>
  )
}

export function LoadingBlock({ label = 'Loading on-chain data…' }: { label?: string }) {
  return (
    <div className="state-block">
      <div className="spinner" />
      <div className="state-block__desc" style={{ marginTop: 10 }}>
        {label}
      </div>
    </div>
  )
}

export function UnavailableBlock({ error }: { error?: string | null }) {
  return (
    <StateBlock
      icon="⚠️"
      title="Data unavailable"
      description={
        error
          ? `The configured data source did not respond (${error}). This section falls back to an explicit "unavailable" state rather than showing a guessed value.`
          : 'The configured data source did not respond. This section falls back to an explicit "unavailable" state rather than showing a guessed value.'
      }
    />
  )
}

export function EmptyState({ title, description, icon = '—' }: { title: string; description?: string; icon?: string }) {
  return <StateBlock icon={icon} title={title} description={description} />
}
