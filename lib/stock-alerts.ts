export const DEFAULT_STOCK_THRESHOLD = 5

export type StockLevel = {
  total_qty: number
  reserved_qty: number
  low_stock_threshold?: number
}
export const availableStock = (variant: StockLevel) =>
  Math.max(0, Number(variant.total_qty) - Number(variant.reserved_qty))
export const stockThreshold = (variant: StockLevel) =>
  variant.low_stock_threshold ?? DEFAULT_STOCK_THRESHOLD
export const hasStockAlert = (variant: StockLevel) =>
  availableStock(variant) <= stockThreshold(variant)
