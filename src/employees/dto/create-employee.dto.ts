import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  role?: string; // free text, e.g. 'sales', 'support'

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
