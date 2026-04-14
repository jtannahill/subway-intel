import { StrictMode, Component } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null; stack: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null, stack: null }
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  componentDidCatch(err: unknown, info: { componentStack?: string }) {
    const stack = info?.componentStack ?? ''
    this.setState({ stack })
    console.error('[ErrorBoundary]', err, stack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column',
          height: '100dvh', gap: 12, padding: 20, background: '#0d0d0d', color: '#888',
          fontFamily: 'monospace', fontSize: 11, overflowY: 'auto',
        }}>
          <div style={{ color: '#ef4444', letterSpacing: '0.1em', marginBottom: 4 }}>APP ERROR</div>
          <div style={{ color: '#ccc', wordBreak: 'break-word' }}>{this.state.error}</div>
          {this.state.stack && (
            <pre style={{ fontSize: 9, color: '#666', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
              {this.state.stack}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              all: 'unset', cursor: 'pointer', padding: '10px 24px', borderRadius: 3,
              border: '1px solid #333', color: '#aaa', fontSize: 11, letterSpacing: '0.08em',
              textAlign: 'center', marginTop: 8,
            }}
          >RELOAD</button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
