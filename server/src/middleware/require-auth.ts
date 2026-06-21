import type { Request, Response, NextFunction, RequestHandler } from 'express'

export interface AuthedUser { id: string; email: string | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser
      accessToken?: string
    }
  }
}

export interface RequireAuthDeps {
  getUser: (token: string) => Promise<AuthedUser | null>
}

export function requireAuth(deps: RequireAuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'missing bearer token' })
    const user = await deps.getUser(token)
    if (!user) return res.status(401).json({ error: 'invalid token' })
    req.user = user
    req.accessToken = token
    next()
  }
}
