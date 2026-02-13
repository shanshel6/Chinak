export interface Product {
  id: number | string;
  name: string;
  price: number;
  image: string;
  domesticShippingFee?: number;
  basePriceIQD?: number;
  category?: string;
  status?: string;
  isActive?: boolean;
  isLocal?: boolean;
  images?: string[] | { id: number; url: string; order: number; type?: string }[];
  specs?: any;
  options?: any[];
  variants?: any[];
  purchaseUrl?: string;
  isFeatured?: boolean;
  averageRating?: string;
  totalReviews?: number;
  reviews?: any[];
  originalPrice?: number;
  stock?: number;
  deliveryTime?: string;
  isAirRestricted?: boolean;
}
