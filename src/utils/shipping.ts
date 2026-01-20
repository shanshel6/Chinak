import type { ShippingRates } from '../types/shipping';

// Packaging Constants (Conservative estimates for "higher guess")
const BOX_PADDING_CM = 3; // 3cm added to each dimension for safe estimation
const WEIGHT_BUFFER_FACTOR = 1.20; // 20% added to weight buffer for safe estimation

export const calculateShippingFee = (
  weight: number | undefined,
  length: number | undefined,
  width: number | undefined,
  height: number | undefined,
  rates: ShippingRates,
  _price: number = 0,
  forcedMethod?: 'AIR' | 'SEA' | 'air' | 'sea',
  _domesticShippingFee: number = 0,
  applyMinimum: boolean = true
) => {
  // If everything is zero/missing, we still want to provide a "higher guess" estimate 
  // for a generic item rather than showing zero shipping.
  // const hasNoData = !weight && !length && !width && !height;

  // Apply Packaging Padding & Buffer (Use conservative defaults if data is missing)
  const rawW = weight || 0.7; // Guess 700g if weight is missing (safe for jeans/clothes)
  const rawL = length || 35;  // Guess 35cm
  const rawWi = width || 25;  // Guess 25cm
  const rawH = height || 15;  // Guess 15cm (safe box height)

  // Boxed Dimensions
  const boxedL = rawL + BOX_PADDING_CM;
  const boxedWi = rawWi + BOX_PADDING_CM;
  const boxedH = rawH + BOX_PADDING_CM;
  const boxedW = rawW * WEIGHT_BUFFER_FACTOR;

  // Determine method - default to sea unless forced
  const method: 'AIR' | 'SEA' = (forcedMethod?.toUpperCase() as 'AIR' | 'SEA') || 'SEA';

  let internationalCost = 0;
  if (method === 'AIR') {
    // For Air: Weight must be available
    if (!weight || weight <= 0) {
      return 0; // Air shipping not available without weight
    }
    // For Air: Based on Actual Weight only (volumetric weight removed as per request)
    // Minimum weight is 1kg
    const effectiveWeight = applyMinimum ? Math.max(boxedW, 1) : boxedW;
    internationalCost = effectiveWeight * rates.airRate;
  } else {
    // For Sea: Based on CBM (Volume)
    const cbm = (boxedL * boxedWi * boxedH) / 1000000;
    internationalCost = cbm * rates.seaRate;
    
    // Minimum cost for Sea is 10,000 IQD
    if (applyMinimum && internationalCost < 10000) {
      internationalCost = 10000;
    }
  }

  // Round international cost to nearest 250 for currency consistency
  const roundedInternational = Math.ceil(internationalCost / 250) * 250;

  return roundedInternational;
};
