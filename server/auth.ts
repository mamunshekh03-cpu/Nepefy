import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

let cachedRuntimeJwtSecret: string | null = null;

function getJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) return envSecret;
  if (!cachedRuntimeJwtSecret) {
    cachedRuntimeJwtSecret = crypto.randomBytes(48).toString('hex');
  }
  return cachedRuntimeJwtSecret;
}

export interface AuthTokenPayload {
  userId: string;
  role: 'USER' | 'ADMIN';
  email: string;
  jti?: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthTokenPayload;
}

export function signToken(payload: AuthTokenPayload): string {
  const jti = payload.jti || crypto.randomUUID();
  return jwt.sign({ ...payload, jti }, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, getJwtSecret()) as AuthTokenPayload;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyToken(token);
    const user = (await db
      .prepare('SELECT id, role, email, status FROM users WHERE id = ?')
      .get(decoded.userId)) as
      | { id: string; role: 'USER' | 'ADMIN'; email: string; status?: string }
      | undefined;

    if (!user) {
      res.status(401).json({ error: 'Account no longer exists' });
      return;
    }

    if (user.status === 'INACTIVE') {
      res.status(403).json({ error: 'Account is suspended by Master Admin' });
      return;
    }

    if (decoded.jti) {
      const session = (await db
        .prepare('SELECT id, is_revoked FROM login_sessions WHERE jti = ?')
        .get(decoded.jti)) as { id: string; is_revoked: number } | undefined;
      if (session && Number(session.is_revoked) === 1) {
        res.status(401).json({ error: 'Session has been revoked. Please sign in again.' });
        return;
      }
      if (session) {
        try {
          await db
            .prepare('UPDATE login_sessions SET last_active_at = ? WHERE id = ?')
            .run(new Date().toISOString(), session.id);
        } catch {
          // non-fatal
        }
      }
    }

    req.auth = { userId: user.id, role: user.role, email: user.email, jti: decoded.jti };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, () => {
    if (req.auth?.role !== 'ADMIN') {
      res.status(403).json({ error: 'Administrator privileges required' });
      return;
    }
    next();
  });
}
