import { Router } from 'express'
import { requireAuth } from '../middleware/require-auth.js'
import { anonClient } from '../supabase.js'
import type { AppConfig } from '../config.js'

export function meRouter(config: AppConfig): Router {
  const supabase = anonClient(config)
  const router = Router()
  router.get(
    '/api/me',
    requireAuth({
      getUser: async (token) => {
        const { data, error } = await supabase.auth.getUser(token)
        if (error || !data.user) return null
        return { id: data.user.id, email: data.user.email ?? null }
      },
    }),
    (req, res) => res.json(req.user),
  )
  return router
}
