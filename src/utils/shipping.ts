export interface ShippingRates {
  airRate: number;
  seaRate: number;
  minFloor: number;
}

export const calculateShippingFee = (
  weight: number | undefined,
  length: number | undefined,
  width: number | undefined,
  height: number | undefined,
  rates: ShippingRates
) => {
  if (!weight && !length && !width && !height) return 0;

  const w = weight || 0.5;
  const l = length || 10;
  const wi = width || 10;
  const h = height || 10;

  // Determine method
  const method = w <= 1 ? 'AIR' : 'SEA';

  let fee = 0;
  if (method === 'AIR') {
    const roundedWeight = Math.ceil(w * 2) / 2;
    fee = Math.max(roundedWeight * rates.airRate, rates.minFloor);
  } else {
    const cbm = (l * wi * h) / 1000000;
    fee = cbm * rates.seaRate;
  }

  // Round to nearest 250
  return Math.ceil(fee / 250) * 250;
};
