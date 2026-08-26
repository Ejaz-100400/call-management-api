export const STOCK_LOCATIONS = ['ambattur', 'kattankulathur', 'sithalapakkam', 'pondicherry', 'warehouse'] as const;

export type StockLocationValue = (typeof STOCK_LOCATIONS)[number];
