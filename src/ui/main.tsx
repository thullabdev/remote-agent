import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import './styles.css'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('The app root element is missing.')
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
