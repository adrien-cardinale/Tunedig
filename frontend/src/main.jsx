import React from 'react'
import ReactDOM from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
)
