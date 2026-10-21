import { PartialType } from '@nestjs/mapped-types';
import { AppointmentStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import { CreateAppointmentDto } from './create-appointment.dto';

export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @IsOptional()
  @IsIn(Object.values(AppointmentStatus))
  status?: AppointmentStatus;
}
