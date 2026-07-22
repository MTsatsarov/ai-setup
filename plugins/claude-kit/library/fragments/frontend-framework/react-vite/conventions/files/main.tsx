import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
<% ui-kit.react_provider_imports %>import App from '@/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <% ui-kit.react_provider_open %>
      <App />
    <% ui-kit.react_provider_close %>
  </StrictMode>,
)
