import React from 'react';

interface Option {
  id: number;
  name: string;
  values: string | string[];
}

interface ProductOptionsProps {
  options: Option[];
  selectedOptions: Record<string, string>;
  onOptionSelect: (optionName: string, value: string) => void;
  variants?: any[];
  onVariantSelect?: (combination: Record<string, string>) => void;
  selectedVariantId?: number | string;
}

const ProductOptions: React.FC<ProductOptionsProps> = ({
  options,
  selectedOptions,
  onOptionSelect,
  variants,
  onVariantSelect,
  selectedVariantId,
}) => {
  // If variants are provided, render them as tags (New "Concept")
  if (variants && variants.length > 0 && onVariantSelect) {
    return (
      <div className="mb-6 space-y-3">
        <h3 className="text-slate-900 dark:text-white text-sm font-black flex items-center gap-2">
          الخيارات المتاحة
          <span className="text-[10px] text-slate-400 font-normal">(اختر واحد)</span>
        </h3>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant, idx) => {
            // Parse combination if it's a string
            let combination = variant.combination;
            if (typeof combination === 'string') {
              try { combination = JSON.parse(combination); } catch { combination = {}; }
            }

            // Generate label from combination values
            const values: string[] = [];
            Object.values(combination).forEach((val: any) => {
              if (Array.isArray(val)) {
                values.push(...val.map((v: any) => 
                  typeof v === 'object' ? (v.value || v.name || JSON.stringify(v)) : String(v)
                ));
              } else if (typeof val === 'object' && val !== null) {
                values.push(val.value || val.name || JSON.stringify(val));
              } else {
                values.push(String(val));
              }
            });
            
            const label = values.join('، '); // Use Arabic comma

            const isSelected = selectedVariantId ? variant.id === selectedVariantId : false;

            return (
              <div
                key={variant.id || idx}
                onClick={() => onVariantSelect(combination)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border-2 cursor-pointer ${
                  isSelected
                    ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20 scale-105'
                    : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-primary/50'
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Fallback to original attribute-based selection
  if (!options || options.length === 0) return null;

  return (
    <div className="mb-6 space-y-6">
      {options.map((option) => {
        const values = typeof option.values === 'string' ? JSON.parse(option.values) : option.values;
        // Detect informational headers - Only if it has NO selectable values or is specifically named
        const isInformational = 
           (option.name === '免费服务' || 
           option.name === 'خدمات مجانية' || 
           option.name === 'خدمة مجانية' || 
           option.name === 'Free Service') && 
           (!values || values.length === 0);

        return (
          <div key={option.id} className="space-y-3">
            <h3 className="text-slate-900 dark:text-white text-sm font-black flex items-center gap-2">
              {option.name}
              {!isInformational && values && values.length > 0 && <span className="text-[10px] text-slate-400 font-normal">(اختر واحد)</span>}
            </h3>
            <div className="flex flex-wrap gap-2">
              {values && values.map((val: any) => {
                const valString = typeof val === 'object' ? (val.value || val.name || JSON.stringify(val)) : String(val);
                return (
                  <div
                    key={valString}
                    onClick={() => !isInformational && onOptionSelect(option.name, valString)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border-2 ${
                      isInformational
                        ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        : selectedOptions[option.name] === valString
                          ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20 scale-105 cursor-pointer'
                          : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-primary/50 cursor-pointer'
                    }`}
                  >
                    {valString}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ProductOptions;
