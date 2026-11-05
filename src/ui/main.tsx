import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { applyAppearance } from './appearance.ts'
import { readPreferences } from './preferences.ts'
import './styles.css'

// Applied before the first render so the saved theme does not flash the default colors.
applyAppearance(readPreferences(), window.matchMedia('(prefers-color-scheme: dark)').matches)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(error => {
    console.error('Could not register the offline service worker:', error)
  })
}

const root = document.getElementById('root')
if (root === null) {
  throw new Error('The app root element is missing.')
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
