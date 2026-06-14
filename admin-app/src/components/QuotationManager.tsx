import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Save,
  X,
  Image as ImageIcon,
  Upload,
  FileText,
  Search,
  Eye,
  Send,
  MessageCircle,
  Calendar,
  User,
  Phone,
  Mail,
  Package,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import {
  fetchQuotations,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  uploadImage
} from '../services/api';
import { Quotation, QuotationItem } from '../types';
import Invoice from './Invoice';

interface DraftItem {
  name: string;
  description: string;
  price: number;
  quantity: number;
  imageUrl: string;
  imageFile?: File;
}

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  DRAFT: { label: 'مسودة', class: 'bg-slate-100 text-slate-700 border-slate-200' },
  ISSUED: { label: 'صادر', class: 'bg-blue-100 text-blue-700 border-blue-200' },
  INVOICED: { label: 'تم اصدار فاتورة', class: 'bg-amber-100 text-amber-700 border-amber-200' },
  PAID: { label: 'مدفوع', class: 'bg-green-100 text-green-700 border-green-200' }
};

const QuotationManager: React.FC<{ settings: any; apiUrl: string }> = ({ settings, apiUrl }) => {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null);
  const [viewingQuotation, setViewingQuotation] = useState<Quotation | null>(null);
  const [error, setError] = useState('');

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('DRAFT');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const quotationViewRef = useRef<HTMLDivElement>(null);

  const loadQuotations = async () => {
    try {
      setLoading(true);
      const data = await fetchQuotations(1, 100);
      setQuotations(data.quotations || []);
    } catch (err: any) {
      console.error('Failed to fetch quotations:', err);
      if (err.response?.status !== 401) {
        setError(err.response?.data?.error || err.message || 'فشل تحميل عروض الأسعار');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuotations();
  }, []);

  const resetForm = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setNotes('');
    setStatus('DRAFT');
    setItems([]);
    setEditingQuotation(null);
    setError('');
  };

  const openCreate = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEdit = (q: Quotation) => {
    setEditingQuotation(q);
    setCustomerName(q.customerName || '');
    setCustomerPhone(q.customerPhone || '');
    setCustomerEmail(q.customerEmail || '');
    setNotes(q.notes || '');
    setStatus(q.status);
    setItems(
      q.items.map((it) => ({
        name: it.name,
        description: it.description || '',
        price: it.price,
        quantity: it.quantity,
        imageUrl: it.imageUrl || ''
      }))
    );
    setShowCreateModal(true);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { name: '', description: '', price: 0, quantity: 1, imageUrl: '' }
    ]);
  };

  const updateItem = (idx: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleImageUpload = async (idx: number, file: File) => {
    try {
      setUploadingIdx(idx);
      const url = await uploadImage(file);
      updateItem(idx, { imageUrl: url, imageFile: file });
    } catch (err: any) {
      console.error('Image upload failed:', err);
      alert(`فشل رفع الصورة: ${err.response?.data?.error || err.message || 'خطأ'}`);
    } finally {
      setUploadingIdx(null);
    }
  };

  const calculateTotal = () => {
    return items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
  };

  const handleSave = async () => {
    if (items.length === 0) {
      alert('الرجاء إضافة منتج واحد على الأقل');
      return;
    }
    if (items.some((it) => !it.name.trim() || it.price <= 0)) {
      alert('الرجاء إدخال اسم وسعر صحيح لكل منتج');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerEmail: customerEmail || undefined,
        notes: notes || undefined,
        status,
        items: items.map((it) => ({
          name: it.name,
          description: it.description || undefined,
          price: Number(it.price),
          quantity: Number(it.quantity),
          imageUrl: it.imageUrl || undefined
        }))
      };

      if (editingQuotation) {
        await updateQuotation(editingQuotation.id, payload);
      } else {
        await createQuotation(payload);
      }

      setShowCreateModal(false);
      resetForm();
      loadQuotations();
    } catch (err: any) {
      console.error('Save failed:', err);
      alert(`فشل الحفظ: ${err.response?.data?.error || err.message || 'خطأ'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('هل أنت متأكد من حذف عرض السعر هذا؟')) return;
    try {
      await deleteQuotation(id);
      loadQuotations();
    } catch (err: any) {
      console.error('Delete failed:', err);
      alert(`فشل الحذف: ${err.response?.data?.error || err.message || 'خطأ'}`);
    }
  };

  const handleSendWhatsApp = (q: Quotation) => {
    if (!q.customerPhone) {
      alert('رقم الهاتف غير متوفر');
      return;
    }
    const phone = q.customerPhone.replace(/\D/g, '');
    const itemsList = q.items
      .map(
        (it) =>
          `• ${it.name} (${it.quantity} x ${it.price.toLocaleString()} = ${(it.quantity * it.price).toLocaleString()} د.ع)`
      )
      .join('\n');

    const message = `مرحباً من DFC، هذا عرض سعر خاص بكم

📋 عرض سعر: ${q.quotationNumber}
التاريخ: ${new Date(q.createdAt).toLocaleDateString('ar-IQ')}

${itemsList}

💰 المجموع: ${q.total.toLocaleString()} د.ع`;

    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${phone}?text=${encoded}`, '_blank');
  };

  const filtered = quotations.filter(
    (q) =>
      q.quotationNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.customerName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.customerPhone || '').includes(searchTerm)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            عروض الأسعار
            <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-black shadow-md">
              {quotations.length}
            </span>
          </h2>
          <p className="text-sm text-slate-500 mt-1 font-bold">قم بإنشاء وإدارة عروض الأسعار للعملاء</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadQuotations}
            className="p-3 bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
            title="تحديث"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white font-black py-3 px-5 rounded-2xl transition-all shadow-xl shadow-blue-200 flex items-center gap-2 text-sm"
          >
            <Plus size={20} />
            عرض سعر جديد
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
        <input
          type="text"
          placeholder="البحث برقم العرض، اسم العميل أو رقم الهاتف..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-12 pr-4 text-sm font-medium focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all shadow-sm"
        />
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-red-50 text-red-600 text-sm font-bold flex items-center gap-3 border border-red-100">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      <div className="space-y-4">
        {filtered.length === 0 && !loading ? (
          <div className="text-center py-32 bg-white rounded-3xl border-2 border-dashed border-slate-100">
            <FileText className="mx-auto text-slate-200 w-20 h-20 mb-6" />
            <h3 className="text-xl font-black text-slate-400">
              {searchTerm ? 'لا توجد نتائج مطابقة' : 'لا توجد عروض أسعار بعد'}
            </h3>
            <p className="text-sm text-slate-400 font-bold mt-2">
              {searchTerm ? 'جرب بحثاً آخر' : 'انقر على "عرض سعر جديد" للبدء'}
            </p>
          </div>
        ) : (
          filtered.map((q) => {
            const statusCfg = STATUS_LABELS[q.status] || STATUS_LABELS.DRAFT;
            return (
              <motion.div
                key={q.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4 gap-3">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <FileText className="text-blue-600" size={20} />
                        <span className="text-lg font-black text-slate-900 truncate">
                          {q.quotationNumber}
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full text-[10px] font-black border ${statusCfg.class}`}
                        >
                          {statusCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-bold text-slate-400 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar size={14} />
                          {new Date(q.createdAt).toLocaleDateString('ar-IQ')}
                        </div>
                        {q.customerName && (
                          <div className="flex items-center gap-1.5">
                            <User size={14} />
                            {q.customerName}
                          </div>
                        )}
                        {q.customerPhone && (
                          <div className="flex items-center gap-1.5">
                            <Phone size={14} />
                            {q.customerPhone}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Package size={14} />
                          {q.items.length} منتج
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-black text-blue-600">
                        {q.total.toLocaleString()} د.ع
                      </div>
                    </div>
                  </div>

                  {q.items.length > 0 && (
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
                      {q.items.slice(0, 5).map((it, idx) => (
                        <div
                          key={idx}
                          className="flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-slate-200 bg-slate-50"
                        >
                          {it.imageUrl ? (
                            <img
                              src={it.imageUrl}
                              alt={it.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                              <ImageIcon size={20} />
                            </div>
                          )}
                        </div>
                      ))}
                      {q.items.length > 5 && (
                        <div className="flex-shrink-0 w-16 h-16 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-xs font-black text-slate-500">
                          +{q.items.length - 5}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => setViewingQuotation(q)}
                      className="flex-1 min-w-[120px] bg-slate-50 text-slate-600 hover:bg-slate-100 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                    >
                      <Eye size={16} /> عرض
                    </button>
                    <button
                      onClick={() => openEdit(q)}
                      className="flex-1 min-w-[120px] bg-blue-50 text-blue-600 hover:bg-blue-100 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                    >
                      <Save size={16} /> تعديل
                    </button>
                    {q.customerPhone && (
                      <button
                        onClick={() => handleSendWhatsApp(q)}
                        className="flex-1 min-w-[120px] bg-green-50 text-green-600 hover:bg-green-100 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                      >
                        <MessageCircle size={16} /> واتساب
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(q.id)}
                      className="bg-red-50 text-red-600 hover:bg-red-100 font-black py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="bg-white w-full max-w-3xl h-[95vh] sm:h-auto sm:max-h-[90vh] rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-10">
                <div>
                  <h3 className="text-xl font-black text-slate-900">
                    {editingQuotation ? 'تعديل عرض السعر' : 'عرض سعر جديد'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                    أضف المنتجات وبيانات العميل
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className="p-3 bg-slate-50 text-slate-400 hover:text-red-500 rounded-2xl transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-1.5">
                      اسم العميل
                    </label>
                    <div className="relative">
                      <User
                        size={16}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="اسم العميل"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pr-10 pl-4 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-1.5">
                      رقم الهاتف
                    </label>
                    <div className="relative">
                      <Phone
                        size={16}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="07XX XXX XXXX"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pr-10 pl-4 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-1.5">
                      البريد الإلكتروني
                    </label>
                    <div className="relative">
                      <Mail
                        size={16}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="email"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pr-10 pl-4 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-600 mb-1.5">
                      الحالة
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-bold focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                    >
                      <option value="DRAFT">مسودة</option>
                      <option value="ISSUED">صادر</option>
                      <option value="INVOICED">تم اصدار فاتورة</option>
                      <option value="PAID">مدفوع</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-600 mb-1.5">
                    ملاحظات
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="ملاحظات إضافية..."
                    rows={2}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none resize-none"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                      <Package size={18} className="text-blue-600" />
                      المنتجات
                    </h4>
                    <button
                      onClick={addItem}
                      className="bg-blue-50 text-blue-600 hover:bg-blue-100 font-black py-2 px-3 rounded-xl transition-all flex items-center gap-1.5 text-xs"
                    >
                      <Plus size={16} /> إضافة منتج
                    </button>
                  </div>

                  <div className="space-y-3">
                    {items.length === 0 ? (
                      <div className="text-center py-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                        <Package className="mx-auto text-slate-300 w-12 h-12 mb-2" />
                        <p className="text-sm font-bold text-slate-400">
                          لا توجد منتجات بعد. انقر "إضافة منتج" للبدء.
                        </p>
                      </div>
                    ) : (
                      items.map((it, idx) => (
                        <div
                          key={idx}
                          className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0">
                              <div
                                onClick={() => fileInputRefs.current[idx]?.click()}
                                className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 bg-white flex items-center justify-center cursor-pointer hover:border-blue-500 overflow-hidden relative"
                              >
                                {it.imageUrl ? (
                                  <img
                                    src={it.imageUrl}
                                    alt="product"
                                    className="w-full h-full object-cover"
                                  />
                                ) : uploadingIdx === idx ? (
                                  <RefreshCw className="animate-spin text-blue-600" size={20} />
                                ) : (
                                  <Upload className="text-slate-400" size={20} />
                                )}
                                <input
                                  ref={(el) => {
                                    fileInputRefs.current[idx] = el;
                                  }}
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleImageUpload(idx, file);
                                  }}
                                />
                              </div>
                            </div>
                            <div className="flex-1 space-y-2">
                              <input
                                type="text"
                                value={it.name}
                                onChange={(e) => updateItem(idx, { name: e.target.value })}
                                placeholder="اسم المنتج"
                                className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-black focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                              />
                              <input
                                type="text"
                                value={it.description}
                                onChange={(e) =>
                                  updateItem(idx, { description: e.target.value })
                                }
                                placeholder="وصف اختياري"
                                className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-xs font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                              />
                            </div>
                            <button
                              onClick={() => removeItem(idx)}
                              className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] font-black text-slate-500 mb-1 block">
                                الكمية
                              </label>
                              <input
                                type="number"
                                min="1"
                                value={it.quantity}
                                onChange={(e) =>
                                  updateItem(idx, {
                                    quantity: Math.max(1, Number(e.target.value))
                                  })
                                }
                                className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-black focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-slate-500 mb-1 block">
                                السعر (د.ع)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={it.price}
                                onChange={(e) =>
                                  updateItem(idx, { price: Number(e.target.value) })
                                }
                                className="w-full bg-white border border-slate-200 rounded-lg py-2 px-3 text-sm font-black focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                              />
                            </div>
                          </div>
                          <div className="text-[10px] font-black text-slate-500 text-left">
                            المجموع: {((it.price || 0) * (it.quantity || 0)).toLocaleString()} د.ع
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 sticky bottom-0">
                <div className="text-sm font-black text-slate-700">
                  المجموع الكلي:{' '}
                  <span className="text-blue-600 text-lg">
                    {calculateTotal().toLocaleString()} د.ع
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                    className="px-4 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all text-sm"
                  >
                    إلغاء
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSubmitting || items.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 px-5 rounded-xl transition-all shadow-lg flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <RefreshCw className="animate-spin" size={18} />
                    ) : (
                      <Save size={18} />
                    )}
                    {editingQuotation ? 'تحديث' : 'حفظ'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Modal */}
      <AnimatePresence>
        {viewingQuotation && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="bg-white w-full max-w-2xl h-[90vh] sm:h-auto sm:max-h-[85vh] rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-10">
                <div>
                  <h3 className="text-xl font-black text-slate-900">
                    {viewingQuotation.quotationNumber}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                    {STATUS_LABELS[viewingQuotation.status]?.label}
                  </p>
                </div>
                <button
                  onClick={() => setViewingQuotation(null)}
                  className="p-3 bg-slate-50 text-slate-400 hover:text-red-500 rounded-2xl transition-all"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                <div className="grid grid-cols-2 gap-3">
                  {viewingQuotation.customerName && (
                    <div className="bg-slate-50 p-3 rounded-2xl">
                      <div className="text-[10px] font-black text-slate-400 uppercase">
                        اسم العميل
                      </div>
                      <div className="text-sm font-black text-slate-700 mt-1">
                        {viewingQuotation.customerName}
                      </div>
                    </div>
                  )}
                  {viewingQuotation.customerPhone && (
                    <div className="bg-slate-50 p-3 rounded-2xl">
                      <div className="text-[10px] font-black text-slate-400 uppercase">
                        رقم الهاتف
                      </div>
                      <div className="text-sm font-black text-slate-700 mt-1" dir="ltr">
                        {viewingQuotation.customerPhone}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {viewingQuotation.items.map((it, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-50 p-3 rounded-2xl flex items-center gap-3"
                    >
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-white border border-slate-200 flex-shrink-0">
                        {it.imageUrl ? (
                          <img
                            src={it.imageUrl}
                            alt={it.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <ImageIcon size={20} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h5 className="font-black text-sm text-slate-800 truncate">
                          {it.name}
                        </h5>
                        {it.description && (
                          <p className="text-xs text-slate-500 truncate">{it.description}</p>
                        )}
                        <div className="text-xs font-bold text-slate-500 mt-0.5">
                          {it.quantity} × {it.price.toLocaleString()} ={' '}
                          <span className="text-blue-600">
                            {(it.quantity * it.price).toLocaleString()}
                          </span>{' '}
                          د.ع
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {viewingQuotation.notes && (
                  <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl">
                    <div className="text-[10px] font-black text-amber-700 uppercase mb-1">
                      ملاحظات
                    </div>
                    <p className="text-sm font-bold text-slate-700">
                      {viewingQuotation.notes}
                    </p>
                  </div>
                )}

                <div className="bg-blue-600 p-6 rounded-2xl text-white shadow-lg">
                  <div className="text-xs font-bold opacity-70 uppercase tracking-widest">
                    المجموع الكلي
                  </div>
                  <div className="text-3xl font-black mt-1">
                    {viewingQuotation.total.toLocaleString()} د.ع
                  </div>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center gap-2 sticky bottom-0">
                {viewingQuotation.customerPhone && (
                  <button
                    onClick={() => handleSendWhatsApp(viewingQuotation)}
                    className="flex-1 bg-green-500 text-white font-black py-2.5 rounded-xl hover:bg-green-600 transition-all flex items-center justify-center gap-2 text-sm"
                  >
                    <MessageCircle size={18} /> ارسال عبر واتساب
                  </button>
                )}
                <button
                  onClick={() => {
                    openEdit(viewingQuotation);
                    setViewingQuotation(null);
                  }}
                  className="flex-1 bg-blue-600 text-white font-black py-2.5 rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Save size={18} /> تعديل
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default QuotationManager;
