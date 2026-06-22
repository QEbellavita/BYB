import rateLimit, { type Options } from 'express-rate-limit'
import type { RequestHandler } from 'express'

const num = (v: string | undefined, d: number) => (v ? Number(v) : d)

const base = (limit: number, windowMs: number, overrides?: Partial<Options>): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests' },
    ...overrides,
  })

export function apiRateLimiter(overrides?: Partial<Options>): RequestHandler {
  return base(num(process.env.RATE_LIMIT_MAX, 100), num(process.env.RATE_LIMIT_WINDOW_MS, 60_000), overrides)
}

export function strictRateLimiter(overrides?: Partial<Options>): RequestHandler {
  return base(num(process.env.RATE_LIMIT_STRICT_MAX, 10), num(process.env.RATE_LIMIT_WINDOW_MS, 60_000), overrides)
}
