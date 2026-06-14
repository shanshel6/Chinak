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

export interface QuotationItem {
  id: number;
  quotationId: number;
  name: string;
  description?: string | null;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  createdAt?: string;
}

export interface Quotation {
  id: number;
  quotationNumber: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  status: string; // DRAFT, ISSUED, INVOICED, PAID
  notes?: string | null;
  total: number;
  createdAt: string;
  updatedAt: string;
  items: QuotationItem[];
}
