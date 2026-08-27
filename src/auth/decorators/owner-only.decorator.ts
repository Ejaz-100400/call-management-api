import { SetMetadata } from '@nestjs/common';

export const OWNER_ONLY_KEY = 'ownerOnly';

/**
 * Restricts a route to the single user with users.is_owner = true --
 * stricter than @Roles('admin'), which every admin passes (e.g. a shared
 * team login). Use for things meant for one specific person, not "whoever
 * has admin access" -- e.g. login/device activity across all accounts.
 */
export const OwnerOnly = () => SetMetadata(OWNER_ONLY_KEY, true);
