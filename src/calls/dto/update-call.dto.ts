import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateCallDto {
  @IsOptional()
  @IsIn(['car_glasses', 'car_modifications', 'unknown'])
  businessCategory?: 'car_glasses' | 'car_modifications' | 'unknown';

  @IsOptional()
  @IsDateString()
  callDate?: string;

  // Empty string means "unassign" -- validated as a UUID by the service when non-empty.
  @IsOptional()
  @IsString()
  employeeId?: string;
}
