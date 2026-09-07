import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/base.css';

class RendererBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[renderer] React render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="renderer-crash">
        <h1>The chat view hit an unexpected response.</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => window.location.reload()}>Reload chat</button>
      </main>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RendererBoundary><App /></RendererBoundary>
  </React.StrictMode>,
);
