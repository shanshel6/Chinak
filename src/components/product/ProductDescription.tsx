import React from 'react';

interface ProductDescriptionProps {
  productName?: string;
  description: string;
  specs?: string | Record<string, any>;
}

const ProductDescription: React.FC<ProductDescriptionProps> = ({
  productName,
  description,
  specs,
}) => {
  const hasSpecs = !!specs && (
    (typeof specs === 'string' && specs.trim().length > 0) ||
    (typeof specs === 'object' && Object.keys(specs).length > 0)
  );
  
  // Robust check for redundancy: remove all whitespace, colons, and punctuation, and convert to lowercase
  const normalize = (str: string | Record<string, any>) => {
    if (typeof str === 'object' && str !== null) {
      return Object.entries(str)
        .map(([k, v]) => `${k}${v}`)
        .join('')
        .toLowerCase()
        .replace(/[\s:\-.,]+/g, '');
    }
    return str?.toLowerCase().replace(/[\s:\-.,]+/g, '') || '';
  };
  
  const normalizedSpecs = hasSpecs ? normalize(specs!) : '';
  const normalizedDescription = normalize(description);
  const normalizedProductName = productName ? normalize(productName) : '';

  const isDescriptionRedundant = (hasSpecs && (
    normalizedDescription === normalizedSpecs || 
    normalizedSpecs.includes(normalizedDescription)
  )) || (!!productName && (
    normalizedDescription === normalizedProductName ||
    normalizedProductName.includes(normalizedDescription)
  )) || (normalizedDescription.length > 0 && normalizedDescription.length < 20 && hasSpecs && normalizedSpecs.includes(normalizedDescription));

  return (
    <div className="mb-8">
      {/* Description Section */}
      {description && !isDescriptionRedundant && (
        <section className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1.5 h-6 bg-primary rounded-full" />
            <h3 className="text-slate-900 dark:text-white text-lg font-black">الوصف</h3>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl p-5 border border-slate-100 dark:border-white/5">
            <div className="text-slate-600 dark:text-slate-300 text-[15px] leading-loose whitespace-pre-line font-medium">
              {description}
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default ProductDescription;
