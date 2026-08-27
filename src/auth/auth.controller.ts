import { Body, Controller, Delete, Get, Logger, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { User } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from './decorators/current-user.decorator';
import { OwnerOnly } from './decorators/owner-only.decorator';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LoginTrackingService } from './login-tracking.service';

const logger = new Logger('AuthController');

@Controller('auth')
export class AuthController {
  constructor(private loginTracking: LoginTrackingService) {}

  @Get('me')
  async me(@CurrentUser() user: User, @Req() req: Request) {
    // The frontend only calls this once per actual sign-in (not on every
    // render or token refresh -- see auth-context.tsx), which is exactly
    // the "a login just happened" signal this needs. Never let a tracking
    // failure turn into a failed login.
    try {
      await this.loginTracking.recordLogin(user, req);
    } catch (err) {
      logger.error(`Login tracking failed: ${(err as Error).message}`);
    }
    return user;
  }

  @Post('location')
  async updateLocation(@CurrentUser() user: User, @Req() req: Request, @Body() dto: UpdateLocationDto) {
    // Fire-and-forget from the frontend's side; failures here are logged,
    // not surfaced -- losing a GPS refinement should never look like an error.
    try {
      await this.loginTracking.updateBrowserLocation(user, req, dto.lat, dto.lng);
    } catch (err) {
      logger.error(`Browser location update failed: ${(err as Error).message}`);
    }
    return { updated: true };
  }

  @Get('devices')
  @OwnerOnly()
  findAllDevices() {
    return this.loginTracking.findAllDevices();
  }

  @Delete('devices/:id')
  @OwnerOnly()
  deleteDevice(@Param('id', ParseUUIDPipe) id: string) {
    return this.loginTracking.deleteDevice(id);
  }
}
