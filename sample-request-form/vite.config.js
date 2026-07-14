import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deliberately a different port (5174) than the admin app (5173) — this is
// a truly separate frontend project, matching the two-URL architecture
// decision (see build conversation). Runs alongside `frontend/` with its
// own `npm run dev`, not merged into it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
})
