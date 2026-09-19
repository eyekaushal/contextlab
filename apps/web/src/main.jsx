/**
 * @module
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
// The two faces, bundled with the dashboard. Vite copies the woff2 files into
// dist and rewrites the urls; the browser fetches only the Latin subset it
// needs, from this server, never from Google.
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './styles.css'

const root = document.getElementById('root')
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
