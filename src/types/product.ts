export interface Product {
  id: number | string;
  name: string;
  chineseName?: string;
  price: number;
  image: string;
  description: string;
  images?: { id: number | string; url: string; order: number; type?: string }[];
  purchaseUrl?: string;
  videoUrl?: string;
  originalPrice?: number;
  reviewsCountShown?: string | number;
  storeEvaluation?: string;
  isFeatured?: boolean;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  domesticShippingFee?: number;
  basePriceRMB?: number;
  isPriceCombined?: boolean;
  variants?: any[];
  options?: any[];
  specs?: any;
  reviews?: any[];
  variant?: any;
}
