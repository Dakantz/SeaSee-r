import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { client } from './client/client.gen'
import { getApiBaseUrl } from './utils/apiConfig'

// Set OpenAPI client base URL dynamically from environment configuration
client.setConfig({ baseUrl: getApiBaseUrl() });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
