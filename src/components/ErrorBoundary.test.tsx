// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

afterEach(() => {
  cleanup()
})

function Bomb(): never {
  throw new Error('boom: unexpected shape')
}

describe('ErrorBoundary', () => {
  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeTruthy()
  })

  it('catches a render error, shows the honest fallback, and logs instead of crashing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('This view hit an unexpected error')).toBeTruthy()
    expect(screen.getByText(/boom: unexpected shape/)).toBeTruthy()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
