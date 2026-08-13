import { PartialType } from '@nestjs/mapped-types';
import { CreateBusinessNumberDto } from './create-business-number.dto';

export class UpdateBusinessNumberDto extends PartialType(CreateBusinessNumberDto) {}
