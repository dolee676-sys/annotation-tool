import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Chip, Panel } from './Annotation'
import './styles.css'

const mode = location.hash.replace('#', '')
const root = createRoot(document.getElementById('root') as HTMLElement)

root.render(
  <React.StrictMode>
    {mode === 'panel' ? <Panel /> : mode === 'chip' ? <Chip /> : <App />}
  </React.StrictMode>
)
