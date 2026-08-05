import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { SupabaseJwtPayload } from './supabase-auth.guard';

/**
 * Runs after SupabaseAuthGuard. Looks up the `users` row matching the
 * verified JWT's `sub`, attaches it to the request as `appUser`, and checks
 * it against any @Roles(...) declared on the route.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const supabaseUser = request.supabaseUser as SupabaseJwtPayload | undefined;
    if (!supabaseUser?.sub) {
      throw new ForbiddenException('No authenticated user on request');
    }

    const appUser = await this.prisma.user.findUnique({ where: { id: supabaseUser.sub } });
    if (!appUser || !appUser.active) {
      throw new ForbiddenException('User is not active in this system');
    }

    request.appUser = appUser;

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // route just requires an authenticated, active user
    }

    if (!requiredRoles.includes(appUser.role)) {
      throw new ForbiddenException(`This action requires one of: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
