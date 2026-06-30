import { useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Send, Loader2 } from 'lucide-react';
import Invoice from './Invoice';

// Minimal shape needed to render the Invoice/Quotation document and message.
export interface QuotationLike {
  quotationNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  createdAt: string;
  total: number;
  items: Array<{
    name: string;
    description?: string;
    price: number;
    quantity: number;
    imageUrl?: string;
  }>;
}

// Build the order-shaped object the Invoice component expects.
function buildInvoiceOrder(q: QuotationLike) {
  return {
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
  };
}

interface Props {
  quotation: QuotationLike;
  settings: any;
  /** 'invoice' renders a paid invoice doc; 'quotation' renders a price quote. */
  mode?: 'invoice' | 'quotation';
  label?: string;
  className?: string;
}

/**
 * Self-contained button that generates the quotation/invoice as a PDF and
 * opens WhatsApp to the customer's number with the file attached. Renders its
 * own off-screen Invoice only while generating, so it can be dropped into any
 * list without extra wiring. Falls back to a wa.me text link if native share
 * isn't available (e.g. on the web).
 */
const SendQuotationWhatsAppButton: React.FC<Props> = ({ quotation, settings, mode = 'quotation', label, className }) => {
  const [busy, setBusy] = useState(false);
  const [renderDoc, setRenderDoc] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const buildMessage = () => {
    const itemsList = quotation.items
      .map(
        (it) =>
          `• ${it.name} (${it.quantity} x ${Number(it.price).toLocaleString()} = ${(
            it.quantity * Number(it.price)
          ).toLocaleString()} د.ع)`
      )
      .join('\n');
    const head = mode === 'invoice' ? '🧾 فاتورة' : '📋 عرض سعر';
    return `مرحباً من DFC

${head}: ${quotation.quotationNumber}
التاريخ: ${new Date(quotation.createdAt).toLocaleDateString('ar-IQ')}

${itemsList}

💰 المجموع: ${Number(quotation.total).toLocaleString()} د.ع`;
  };

  const openWaFallback = (phone: string) => {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildMessage())}`, '_blank');
  };

  const handleClick = async () => {
    if (busy) return;
    const phone = (quotation.customerPhone || '').replace(/\D/g, '');
    if (!phone) {
      alert('رقم الهاتف غير متوفر');
      return;
    }

    setBusy(true);
    setRenderDoc(true);
    const fileName = `DFC-${mode === 'invoice' ? 'Invoice' : 'Quotation'}-${quotation.quotationNumber}.pdf`;
    try {
      // Let the off-screen Invoice mount before capturing it.
      await new Promise((r) => setTimeout(r, 300));

      let pdfUri: string | null = null;
      if (ref.current) {
        const canvas = await html2canvas(ref.current, {
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
        try {
          const saved = await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Cache
          });
          pdfUri = saved.uri;
        } catch {
          pdfUri = null;
        }
      }

      if (pdfUri) {
        try {
          await Share.share({
            title: fileName,
            text: buildMessage(),
            files: [pdfUri],
            dialogTitle: 'إرسال عبر واتساب'
          });
          return;
        } catch {
          // user cancelled or native share unavailable — fall through to wa.me
        }
      }
      openWaFallback(phone);
    } catch (e) {
      console.error('Send-via-WhatsApp failed:', e);
      openWaFallback(phone);
    } finally {
      setBusy(false);
      setRenderDoc(false);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        className={
          className ||
          'flex-1 bg-green-500 text-white hover:bg-green-600 font-black py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50'
        }
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {busy ? 'جاري التجهيز...' : label || 'إرسال PDF عبر واتساب'}
      </button>

      {/* Off-screen document captured for the PDF (only while generating). */}
      {renderDoc && (
        <div className="fixed -left-[2000px] top-0 opacity-0 pointer-events-none overflow-hidden" aria-hidden>
          <div ref={ref}>
            <Invoice order={buildInvoiceOrder(quotation)} settings={settings} mode={mode} />
          </div>
        </div>
      )}
    </>
  );
};

export default SendQuotationWhatsAppButton;
