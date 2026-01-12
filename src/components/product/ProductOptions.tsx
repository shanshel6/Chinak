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
}

const ProductOptions: React.FC<ProductOptionsProps> = ({
  options,
  selectedOptions,
  onOptionSelect,
}) => {
  if (!options || options.length === 0) return null;

  return (
    <div className="mb-6 space-y-6">
      {options.map((option) => {
        const values = typeof option.values === 'string' ? JSON.parse(option.values) : option.values;
        // Detect informational headers
        const isInformational = 
           option.name === '免费服务' || 
           option.name === 'خدمات مجانية' || 
           option.name === 'خدمة مجانية' || 
           option.name === 'Free Service';

        return (
          <div key={option.id} className="space-y-3">
            <h3 className="text-slate-900 dark:text-white text-sm font-black flex items-center gap-2">
              {option.name}
              {!isInformational && <span className="text-[10px] text-slate-400 font-normal">(اختر واحد)</span>}
            </h3>
            <div className="flex flex-wrap gap-2">
              {values.map((val: any) => {
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