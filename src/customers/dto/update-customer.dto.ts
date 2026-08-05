import { IsOptional, IsString } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Deliberately no phoneNumber field here -- it's the dedup key the AI
  // pipeline and duplicate-detection rely on, so it stays immutable via the
  // API. Fix a wrong phone number by merging into (or creating) the correct
  // customer record instead.
}
