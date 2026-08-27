import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { RolesGuard } from './guards/roles.guard';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard';
import { LoginTrackingService } from './login-tracking.service';

@Module({
  controllers: [AuthController],
  providers: [
    LoginTrackingService,
    // Order matters: token verification first, then role lookup/check.
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
