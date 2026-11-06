import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Home Movie Theatre crashed:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="text-4xl">🎬</div>
          <h1 className="text-2xl font-black">Something went wrong</h1>
          <p className="max-w-lg text-sm text-white/50">{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">
            Reload the app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
