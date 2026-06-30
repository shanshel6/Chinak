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
  Calendar,
  User,
  Phone,
  Mail,
  Package,
  AlertCircle,
  Send
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import Invoice from './Invoice';

interface LocalQuotation {
  id: string;
  quotationNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  status: string; // DRAFT, ISSUED, INVOICED, PAID
  notes: string;
  total: number;
  createdAt: string;
  items: Array<{
    name: string;
    description: string;
    price: number;
    quantity: number;
    imageUrl: string; // dataURL
  }>;
}

interface DraftItem {
  name: string;
  description: string;
  price: number;
  quantity: number;
  imageUrl: string;
}

const STATUS_LABELS: Record<string, { label: string; class: string }> = {
  DRAFT: { label: 'مسودة', class: 'bg-slate-100 text-slate-700 border-slate-200' },
  ISSUED: { label: 'صادر', class: 'bg-blue-100 text-blue-700 border-blue-200' },
  INVOICED: { label: 'تم اصدار فاتورة', class: 'bg-amber-100 text-amber-700 border-amber-200' },
  PAID: { label: 'مدفوع', class: 'bg-green-100 text-green-700 border-green-200' }
};

const STORAGE_KEY = 'admin_local_quotations';

const loadFromStorage = (): LocalQuotation[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const saveToStorage = (data: LocalQuotation[]) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save quotations to session storage:', e);
  }
};

const fileToDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const generateQuotationNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `QTN-${date}-${random}`;
};

const QuotationManager: React.FC<{ settings: any; apiUrl: string }> = ({ settings }) => {
  const [quotations, setQuotations] = useState<LocalQuotation[]>(loadFromStorage);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<LocalQuotation | null>(null);
  const [viewingQuotation, setViewingQuotation] = useState<LocalQuotation | null>(null);
  const [error, setError] = useState('');

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('DRAFT');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const pdfRenderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveToStorage(quotations);
  }, [quotations]);

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

  const openEdit = (q: LocalQuotation) => {
    setEditingQuotation(q);
    setCustomerName(q.customerName);
    setCustomerPhone(q.customerPhone);
    setCustomerEmail(q.customerEmail);
    setNotes(q.notes);
    setStatus(q.status);
    setItems(
      q.items.map((it) => ({
        name: it.name,
        description: it.description,
        price: it.price,
        quantity: it.quantity,
        imageUrl: it.imageUrl
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
      const dataUrl = await fileToDataURL(file);
      updateItem(idx, { imageUrl: dataUrl });
    } catch (err: any) {
      console.error('Image read failed:', err);
      alert('فشل قراءة الصورة');
    } finally {
      setUploadingIdx(null);
    }
  };

  const calculateTotal = () =>
    items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

  const handleSave = () => {
    if (items.length === 0) {
      alert('الرجاء إضافة منتج واحد على الأقل');
      return;
    }
    if (items.some((it) => !it.name.trim() || it.price <= 0)) {
      alert('الرجاء إدخال اسم وسعر صحيح لكل منتج');
      return;
    }

    const total = calculateTotal();

    if (editingQuotation) {
      // Update existing
      setQuotations((prev) =>
        prev.map((q) =>
          q.id === editingQuotation.id
            ? {
                ...q,
                customerName,
                customerPhone,
                customerEmail,
                notes,
                status,
                total,
                items: items.map((it) => ({ ...it }))
              }
            : q
        )
      );
    } else {
      // Create new local
      const newQuotation: LocalQuotation = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        quotationNumber: generateQuotationNumber(),
        customerName,
        customerPhone,
        customerEmail,
        notes,
        status,
        total,
        createdAt: new Date().toISOString(),
        items: items.map((it) => ({ ...it }))
      };
      setQuotations((prev) => [newQuotation, ...prev]);
    }

    setShowCreateModal(false);
    resetForm();
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف عرض السعر هذا؟')) return;
    setQuotations((prev) => prev.filter((q) => q.id !== id));
    if (viewingQuotation?.id === id) setViewingQuotation(null);
  };

  // Build a fake order-shape object so the existing Invoice component renders it
  const buildInvoiceOrder = (q: LocalQuotation) => ({
    id: q.quotationNumber,
    createdAt: q.createdAt,
    user: { name: q.customerName, phone: q.customerPhone, email: q.customerEmail },
    address: { name: q.customerName, phone: q.customerPhone, city: '', street: '', buildingNo: '' },
    items: q.items.map((it) => ({
      product: { name: it.name, image: it.imageUrl },
      quantity: it.quantity,
      price: it.price,
      selectedOptions: it.description || null,
      notes: null
    })),
    internationalShippingFee: 0,
    discountAmount: 0,
    total: q.total
  });

  const generatePDF = async (q: LocalQuotation): Promise<string | null> => {
    try {
      setIsGeneratingPDF(true);
      setViewingQuotation(q); // ensure ref has content
      // Wait for the hidden render to mount/refresh
      await new Promise((r) => setTimeout(r, 250));
      if (!pdfRenderRef.current) {
        console.error('PDF render ref missing');
        return null;
      }
      const canvas = await html2canvas(pdfRenderRef.current, {
        scale: 1.5,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 800
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.85);
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

      const pdfBase64 = pdf.output('datauristring').split(',')[1];
      const fileName = `DFC-Quotation-${q.quotationNumber}.pdf`;
      const saved = await Filesystem.writeFile({
        path: fileName,
        data: pdfBase64,
        directory: Directory.Cache
      });
      return saved.uri;
    } catch (err) {
      console.error('PDF generation failed:', err);
      return null;
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleSendWhatsApp = async (q: LocalQuotation) => {
    if (!q.customerPhone) {
      alert('رقم الهاتف غير متوفر');
      return;
    }
    const phone = q.customerPhone.replace(/\D/g, '');
    const itemsList = q.items
      .map(
        (it) =>
          `• ${it.name} (${it.quantity} x ${it.price.toLocaleString()} = ${(
            it.quantity * it.price
          ).toLocaleString()} د.ع)`
      )
      .join('\n');

    const message = `مرحباً من DFC، هذا عرض سعر خاص بكم

📋 عرض سعر: ${q.quotationNumber}
التاريخ: ${new Date(q.createdAt).toLocaleDateString('ar-IQ')}

${itemsList}

💰 المجموع: ${q.total.toLocaleString()} د.ع`;

    const pdfUri = await generatePDF(q);
    if (pdfUri) {
      try {
        await Share.share({
          title: `Quotation ${q.quotationNumber}`,
          text: message,
          files: [pdfUri],
          dialogTitle: 'ارسال عرض السعر عبر واتساب'
        });
        return;
      } catch (e) {
        // fall through to wa.me
      }
    }
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
          <p className="text-sm text-slate-500 mt-1 font-bold">
            إنشاء عروض أسعار مخصصة وإرسالها كملف PDF عبر واتساب
          </p>
        </div>
        <button
          onClick={openCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white font-black py-3 px-5 rounded-2xl transition-all shadow-xl shadow-blue-200 flex items-center gap-2 text-sm"
        >
          <Plus size={20} />
          عرض سعر جديد
        </button>
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
        {filtered.length === 0 ? (
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
                    {q.customerPhone && (
                      <button
                        onClick={() => handleSendWhatsApp(q)}
                        disabled={isGeneratingPDF}
                        className="flex-1 min-w-[160px] bg-green-500 text-white hover:bg-green-600 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50"
                      >
                        <Send size={16} /> {isGeneratingPDF ? 'جاري التجهيز...' : 'إرسال PDF عبر واتساب'}
                      </button>
                    )}
                    <button
                      onClick={() => setViewingQuotation(q)}
                      className="flex-1 min-w-[100px] bg-slate-50 text-slate-600 hover:bg-slate-100 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                    >
                      <Eye size={16} /> عرض
                    </button>
                    <button
                      onClick={() => openEdit(q)}
                      className="flex-1 min-w-[100px] bg-blue-50 text-blue-600 hover:bg-blue-100 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs"
                    >
                      تعديل
                    </button>
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
                                  <span className="text-xs text-blue-600 font-bold">
                                    جاري...
                                  </span>
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
                    disabled={items.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 px-5 rounded-xl transition-all shadow-lg flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    <Save size={18} />
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
                    disabled={isGeneratingPDF}
                    className="flex-1 bg-green-500 text-white font-black py-2.5 rounded-xl hover:bg-green-600 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {isGeneratingPDF ? (
                      <span className="text-xs">جاري تجهيز الـ PDF...</span>
                    ) : (
                      <>
                        <Send size={18} /> ارسال PDF عبر واتساب
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => {
                    openEdit(viewingQuotation);
                    setViewingQuotation(null);
                  }}
                  className="flex-1 bg-blue-600 text-white font-black py-2.5 rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  تعديل
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden PDF render target */}
      <div className="fixed -left-[2000px] top-0 opacity-0 pointer-events-none overflow-hidden">
        {viewingQuotation && (
          <div ref={pdfRenderRef}>
            <Invoice order={buildInvoiceOrder(viewingQuotation)} settings={settings} mode="quotation" />
          </div>
        )}
      </div>

      {/* Loading overlay while PDF is being generated */}
      {isGeneratingPDF && (
        <div className="fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="font-black text-slate-800">جاري تجهيز ملف PDF...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuotationManager;
