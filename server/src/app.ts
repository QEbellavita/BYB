import express from 'express'
import { healthRouter } from './routes/health.js'
import { meRouter } from './routes/me.js'
import type { AppConfig } from './config.js'

export function createApp(config?: AppConfig): express.Express {
  const app = express()
  app.use(express.json())
  app.use(healthRouter)
  if (config) app.use(meRouter(config))
  return app
}
