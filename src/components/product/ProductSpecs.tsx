import React from 'react';

interface ProductSpecsProps {
  specs?: string | Record<string, any>;
}

const ProductSpecs: React.FC<ProductSpecsProps> = ({ specs }) => {
  const hasSpecs = !!specs && (
    (typeof specs === 'string' && specs.trim().length > 0) ||
    (typeof specs === 'object' && Object.keys(specs).length > 0)
  );

  if (!hasSpecs) return null;

  let parsedSpecs: { label: string; value: string }[] = [];

  let specsData = specs;
  if (typeof specs === 'string' && specs.trim().startsWith('{')) {
    try {
      specsData = JSON.parse(specs);
    } catch (e) {
      specsData = specs;
    }
  }

  if (typeof specsData === 'string') {
    parsedSpecs = specsData.split('\n')
      .map(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
          return {
            label: parts[0].trim(),
            value: parts.slice(1).join(':').trim()
          };
        }
        return { label: '', value: line.trim() };
      })
      .filter(item => {
        const label = item.label.toLowerCase();
        return item.value.length > 0 && 
               label !== 'price' && 
               label !== 'السعر' && 
               label !== 'price_rmb';
      });
  } else if (typeof specsData === 'object' && specsData !== null) {
    parsedSpecs = Object.entries(specsData)
      .filter(([key]) => {
        const label = key.toLowerCase();
        return label !== 'price' && 
               label !== 'السعر' && 
               label !== 'price_rmb';
      })
      .map(([label, value]) => ({
        label,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value)
      }));
  }

  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1.5 h-6 bg-primary rounded-full" />
        <h3 className="text-slate-900 dark:text-white text-lg font-black">المواصفات</h3>
      </div>
      
      <div className="grid grid-cols-1 gap-3">
        {parsedSpecs.map((spec, index) => (
          <div 
            key={index} 
            className="flex items-center justify-between p-4 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-100 dark:border-white/5 shadow-sm hover:border-primary/20 transition-colors"
          >
            {spec.label ? (
              <>
                <span className="text-slate-500 dark:text-slate-400 text-sm font-bold">{spec.label}</span>
                <span className="text-slate-900 dark:text-white text-sm font-black">{spec.value}</span>
              </>
            ) : (
              <span className="text-slate-900 dark:text-white text-sm font-medium w-full text-center">{spec.value}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export default ProductSpecs;
