import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export type SupabaseJwtPayload = JWTPayload & {
  sub: string; // this is the auth.users.id / public.users.id
  email?: string;
};

// jose fetches and caches Supabase's public signing keys from this endpoint,
// and automatically re-fetches after a rotation (Project Settings -> JWT Keys
// -> Rotate Keys). There's no secret to store or update in this app at all --
// only the public keys are needed to verify a token, never a shared secret.
const JWKS = createRemoteJWKSet(new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

/**
 * Verifies the `Authorization: Bearer <token>` header against Supabase's
 * public JWT signing keys (Project Settings -> JWT Keys -> JWT Signing Keys
 * tab). This is the current, recommended approach -- it only works once your
 * project has a JWT Signing Keys pair (new projects generally do by default;
 * older projects may need to click "Migrate JWT secret" on that page first).
 *
 * If your project's JWT Keys page shows ONLY a "Legacy JWT Secret" with no
 * JWT Signing Keys yet, this JWKS call will fail. Fallback in that case:
 *
 *   npm install jsonwebtoken @types/jsonwebtoken
 *   import * as jwt from 'jsonwebtoken';
 *   const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET!) as SupabaseJwtPayload;
 *
 * This only proves "this is a valid, logged-in Supabase user" -- it does
 * NOT check roles. RolesGuard (runs right after this one) handles that,
 * using the app's own `users` table.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'] as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice('Bearer '.length);

    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      });
      request.supabaseUser = payload as SupabaseJwtPayload;
      return true;
    } catch (err) {
      // Logged server-side only -- the client still just gets a generic 401,
      // but you can see the *real* reason (expired, wrong issuer, no matching
      // key, JWKS fetch failure, etc.) in this terminal's output.
      console.error('[SupabaseAuthGuard] token verification failed:', err);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
