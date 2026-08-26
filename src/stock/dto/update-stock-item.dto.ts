import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateStockItemDto } from './create-stock-item.dto';

// initialStock is create-only -- editing an item should never silently log
// another movement, that would be a hidden side effect the user didn't ask
// for. Starting stock corrections belong on the Movements page.
export class UpdateStockItemDto extends PartialType(OmitType(CreateStockItemDto, ['initialStock'] as const)) {}
