import { Transform } from 'class-transformer';

/**
 * Multi-select filters arrive as one comma-separated query value (e.g.
 * `?category=car_glasses,unknown`) rather than repeated keys, since that's
 * simpler for the frontend to build and works the same whether the caller
 * passes one value or several. Converts to a string[] for class-validator's
 * `each: true` decorators to run against; empty/missing stays undefined so
 * "no filter" behaves exactly as it did before this field became an array.
 */
export function ToArray() {
  return Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value;
    return String(value)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  });
}
