import { Component } from 'react'
import type { ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('HOODL Analytics render error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty">
          <div className="empty-icon">◌</div>
          <h3>This view hit an unexpected error</h3>
          <p>
            Rendering failed, most likely because a data source returned an unexpected shape. No fabricated
            data is shown in its place.
          </p>
          <small>
            <b>Detail</b> {this.state.error.message || 'Unknown error'}
          </small>
        </div>
      )
    }
    return this.props.children
  }
}
