import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import { useThemeStore } from './store/useThemeStore'
import App from './App.tsx'
import { AppErrorBoundary } from './components/shared/AppErrorBoundary.tsx'
import { retireLegacyClientCache } from './lib/clientRecovery.ts'

// Initialize theme from persisted state
const theme = useThemeStore.getState().theme;
if (theme === 'dark') {
  document.documentElement.classList.add('dark');
}

// Service workers are deliberately retired: the legacy worker cached the app
// shell indefinitely and could make a healthy server appear blank. Do not
// await cleanup; rendering must remain available even if browser storage is
// blocked or unavailable.
void retireLegacyClientCache();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<div className="min-h-screen bg-surface-secondary flex items-center justify-center"><div className="text-text-tertiary">Loading...</div></div>}>
        <App />
      </Suspense>
    </AppErrorBoundary>
  </StrictMode>,
)
