import { IsBoolean } from 'class-validator';

export class BookmarkCustomerDto {
  @IsBoolean()
  bookmarked: boolean;
}
