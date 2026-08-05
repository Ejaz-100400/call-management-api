import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to one or more roles from the `users.role` column.
 * A route with no @Roles() decorator just requires an authenticated,
 * active user (any role).
 *
 * Example: @Roles('admin', 'manager')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
