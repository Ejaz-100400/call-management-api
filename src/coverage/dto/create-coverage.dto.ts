import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateCoverageDto {
  @IsString()
  phoneNumber: string;

  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  startHour?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  endHour?: number;

  @IsOptional()
  @IsBoolean()
  isBackup?: boolean;
}
