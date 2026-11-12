import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { applyAppearance } from './appearance.ts'
import { readPreferences } from './preferences.ts'
import { installScrollbarVisibility } from './scrollbars.ts'
// The fonts ship with the app, so the UI looks the same on every device instead of falling back to whatever the system has.
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles.css'

// Applied before the first render so the saved theme does not flash the default colors.
applyAppearance(readPreferences(), window.matchMedia('(prefers-color-scheme: dark)').matches)

installScrollbarVisibility()

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
