import React, { useState } from 'react';
import { X } from 'lucide-react';

interface ProductNotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
  productName: string;
}

const ProductNotesModal: React.FC<ProductNotesModalProps> = ({ isOpen, onClose, onConfirm, productName }) => {
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(notes);
    setNotes('');
    onClose();
  };

  const handleCancel = () => {
    setNotes('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">إضافة ملاحظات</h3>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X size={20} className="text-slate-500 dark:text-slate-400" />
          </button>
        </div>
        
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          {productName}
        </p>
        
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
          اكتب ملاحظاتك هنا (مثل: المقاس، اللون، أو أي تفاصيل أخرى تود إخبارنا بها عن المنتج)
        </p>
        
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="اكتب ملاحظاتك هنا..."
          className="w-full min-h-[120px] p-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
          dir="rtl"
        />
        
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleCancel}
            className="flex-1 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            إلغاء
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 transition-colors"
          >
            إضافة للسلة
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductNotesModal;
