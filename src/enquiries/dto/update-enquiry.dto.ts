import { PartialType } from '@nestjs/mapped-types';
import { CreateEnquiryDto } from './create-enquiry.dto';

export class UpdateEnquiryDto extends PartialType(CreateEnquiryDto) {}
