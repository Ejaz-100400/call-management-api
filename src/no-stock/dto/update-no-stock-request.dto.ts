import { PartialType } from '@nestjs/mapped-types';
import { CreateNoStockRequestDto } from './create-no-stock-request.dto';

export class UpdateNoStockRequestDto extends PartialType(CreateNoStockRequestDto) {}
