import { Controller, Get } from '@nestjs/common';

@Controller('business-numbers')
export class BusinessNumbersController {
  @Get()
  findAll() {
    // With exactly two fixed lines, env config is enough. If you ever add a
    // third number, promote this into the business_numbers table discussed
    // earlier and query it from Postgres instead.
    return [
      { number: process.env.CAR_GLASSES_NUMBER, category: 'car_glasses', label: 'Car Glasses' },
      {
        number: process.env.CAR_MODIFICATIONS_NUMBER,
        category: 'car_modifications',
        label: 'Car Modifications',
      },
    ];
  }
}
