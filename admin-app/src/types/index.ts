export interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: string;
}

export interface OrderItem {
  id: number;
  productId: number;
  quantity: number;
  price: number;
  notes?: string | null;
  product: {
    name: string;
    image: string;
    purchaseUrl?: string;
  };
}

export interface Order {
  id: number;
  status: string;
  total: number;
  createdAt: string;
  user: User;
  items: OrderItem[];
  paymentMethod?: string;
  internationalShippingFee?: number;
}
