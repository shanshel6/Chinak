import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Receipt, Eye, Send, FileText, Calendar, User, Phone, Clock, Search, RefreshCw } from 'lucide-react';
import { Order } from '../types';
import SendQuotationWhatsAppButton, { QuotationLike } from './SendQuotationWhatsAppButton';

// Must match the key QuotationManager persists to.
const QUOTATIONS_STORAGE_KEY = 'admin_local_quotations';

interface InvoicesViewProps {
  orders: Order[];
  getStatusConfig: (status: string) => { label: string; class: string };
  onOpenOrder: (order: Order) => void;
  onSendInvoice: (order: Order) => void;
  settings: any;
}

const INVOICE_STATUSES = ['AWAITING_PAYMENT', 'PREPARING', 'SHIPPED', 'ARRIVED_IRAQ', 'DELIVERED'];

const InvoicesView: React.FC<InvoicesViewProps> = ({ orders, getStatusConfig, onOpenOrder, onSendInvoice, settings }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  // Quotations that were marked PAID become invoices and show up here too.
  const [paidQuotations, setPaidQuotations] = useState<QuotationLike[]>([]);

  const loadPaidQuotations = () => {
    try {
      const raw = sessionStorage.getItem(QUOTATIONS_STORAGE_KEY);
      const all = raw ? JSON.parse(raw) : [];
      setPaidQuotations(Array.isArray(all) ? all.filter((q: any) => q?.status === 'PAID') : []);
    } catch {
      setPaidQuotations([]);
    }
  };
  useEffect(() => { loadPaidQuotations(); }, []);

  const invoiceableOrders = orders.filter((o) => INVOICE_STATUSES.includes(o.status));

  const filtered = invoiceableOrders.filter((o) => {
    const matchesSearch =
      String(o.id).includes(searchTerm) ||
      o.user?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.user?.phone?.includes(searchTerm);
    const matchesStatus = statusFilter === 'ALL' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
          الفواتير
          <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-black shadow-md">
            {invoiceableOrders.length}
          </span>
        </h2>
        <p className="text-sm text-slate-500 mt-1 font-bold">
          جميع الطلبات القابلة للفوترة - إرسال الفاتورة للعميل عبر واتساب
        </p>
      </div>

      {/* Paid quotations -> invoices */}
      {paidQuotations.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-700 flex items-center gap-2">
              <FileText size={16} className="text-green-600" />
              فواتير عروض الأسعار المدفوعة
              <span className="bg-green-600 text-white px-2 py-0.5 rounded-full text-[10px] font-black">
                {paidQuotations.length}
              </span>
            </h3>
            <button
              onClick={loadPaidQuotations}
              className="text-slate-400 hover:text-blue-600 p-1.5 rounded-lg transition-colors"
              title="تحديث"
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {paidQuotations.map((q) => (
            <div
              key={q.quotationNumber}
              className="bg-white rounded-3xl shadow-sm border border-green-100 overflow-hidden p-5"
            >
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <Receipt className="text-green-600" size={18} />
                    <span className="text-base font-black text-slate-900">{q.quotationNumber}</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black border bg-green-100 text-green-700 border-green-200">
                      مدفوع
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs font-bold text-slate-400 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={13} />
                      {new Date(q.createdAt).toLocaleDateString('ar-IQ')}
                    </div>
                    {q.customerName && (
                      <div className="flex items-center gap-1.5">
                        <User size={13} />
                        {q.customerName}
                      </div>
                    )}
                    {q.customerPhone && (
                      <div className="flex items-center gap-1.5" dir="ltr">
                        <Phone size={13} />
                        {q.customerPhone}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-black text-green-600">
                    {Number(q.total).toLocaleString()} د.ع
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">
                    {q.items?.length || 0} منتج
                  </div>
                </div>
              </div>
              <SendQuotationWhatsAppButton
                quotation={q}
                settings={settings}
                mode="invoice"
                label="إرسال الفاتورة عبر واتساب"
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="البحث برقم الطلب أو العميل..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-11 pr-4 text-sm font-medium focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none shadow-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white border border-slate-200 rounded-2xl py-3 px-4 text-sm font-black focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none shadow-sm"
        >
          <option value="ALL">جميع الحالات</option>
          <option value="AWAITING_PAYMENT">بانتظار الدفع</option>
          <option value="PREPARING">قيد التجهيز</option>
          <option value="SHIPPED">تم الشحن</option>
          <option value="ARRIVED_IRAQ">وصل للعراق</option>
          <option value="DELIVERED">تم التسليم</option>
        </select>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-100">
            <Receipt className="mx-auto text-slate-200 w-16 h-16 mb-4" />
            <h3 className="text-lg font-black text-slate-400">لا توجد فواتير</h3>
            <p className="text-sm text-slate-400 font-bold mt-1">
              ستظهر هنا الطلبات القابلة للفوترة
            </p>
          </div>
        ) : (
          filtered.map((order) => {
            const statusCfg = getStatusConfig(order.status);
            return (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-lg transition-all"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4 gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <Receipt className="text-blue-600" size={18} />
                        <span className="text-base font-black text-slate-900">
                          فاتورة #{order.id}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${statusCfg.class}`}
                        >
                          {statusCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-bold text-slate-400 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={13} />
                          {new Date(order.createdAt).toLocaleDateString('ar-IQ')}
                        </div>
                        {order.user?.name && (
                          <div className="flex items-center gap-1.5">
                            <User size={13} />
                            {order.user.name}
                          </div>
                        )}
                        {order.user?.phone && (
                          <div className="flex items-center gap-1.5" dir="ltr">
                            <Phone size={13} />
                            {order.user.phone}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-black text-blue-600">
                        {order.total.toLocaleString()} د.ع
                      </div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase">
                        {order.items?.length || 0} منتج
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => onOpenOrder(order)}
                      className="flex-1 bg-slate-50 text-slate-600 hover:bg-slate-100 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                    >
                      <Eye size={14} /> عرض التفاصيل
                    </button>
                    <button
                      onClick={() => onSendInvoice(order)}
                      className="flex-1 bg-blue-600 text-white hover:bg-blue-700 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs shadow-lg shadow-blue-100"
                    >
                      <Send size={14} /> ارسال الفاتورة
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default InvoicesView;
