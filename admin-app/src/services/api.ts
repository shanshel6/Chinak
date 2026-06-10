import axios from 'axios';

const DEFAULT_URL = 'https://chinak-production.up.railway.app';

const getBaseUrl = () => {
  const stored = localStorage.getItem('api_url');
  // Force reset if it's an old railway URL but not the current production one
  if (stored && stored.includes('railway.app') && !stored.includes('chinak-production')) {
    localStorage.setItem('api_url', DEFAULT_URL);
    return DEFAULT_URL;
  }
  return stored || DEFAULT_URL;
};

export const api = axios.create({
  baseURL: getBaseUrl(),
});

export const updateApiUrl = (url: string) => {
  const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  localStorage.setItem('api_url', cleanUrl);
  api.defaults.baseURL = cleanUrl;
  console.log('[API] URL updated to:', cleanUrl);
};

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.warn('[API] 401 Unauthorized - Clearing token and reloading...');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      // Use window.location to force a full app reload and show login screen
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export const login = async (email: string, password: string) => {
  const response = await api.post('/api/auth/email-login', { email, password });
  return response.data;
};

export const fetchOrders = async () => {
  const response = await api.get('/api/admin/orders');
  return response.data;
};

export const updateOrderStatus = async (orderId: number, status: string) => {
  const response = await api.put(`/api/admin/orders/${orderId}/status`, { status });
  return response.data;
};

export const updateOrderInternationalFee = async (orderId: number, fee: number) => {
  const response = await api.put(`/api/admin/orders/${orderId}/international-fee`, { fee });
  return response.data;
};

export const fetchAdminOrderDetails = async (orderId: number) => {
  const response = await api.get(`/api/admin/orders/${orderId}`);
  return response.data;
};

export const updateProductPriceFromOrder = async (productId: number, orderId: number, newPrice: number) => {
  const response = await api.put(`/api/admin/products/${productId}/price-from-order`, { orderId, newPrice });
  return response.data;
};

export const archiveProductFromOrder = async (productId: number, orderId: number) => {
  const response = await api.put(`/api/admin/products/${productId}/archive-from-order`, { orderId });
  return response.data;
};

export const updateOrderPaymentMethod = async (orderId: number, paymentMethod: string) => {
  const response = await api.put(`/api/admin/orders/${orderId}/payment-method`, { paymentMethod });
  return response.data;
};

export const fetchSettings = async () => {
  const response = await api.get('/api/settings');
  return response.data;
};
