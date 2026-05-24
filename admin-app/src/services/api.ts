import axios from 'axios';

const getBaseUrl = () => {
  return localStorage.getItem('api_url') || 'https://chinak-production.up.railway.app';
};

export const api = axios.create({
  baseURL: getBaseUrl(),
});

export const updateApiUrl = (url: string) => {
  localStorage.setItem('api_url', url);
  api.defaults.baseURL = url;
};

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

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
