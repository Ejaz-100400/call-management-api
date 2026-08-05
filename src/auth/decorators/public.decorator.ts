import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as not requiring a logged-in Supabase user.
 * Use sparingly -- currently only the health check and the telephony
 * provider's webhook should carry this.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
