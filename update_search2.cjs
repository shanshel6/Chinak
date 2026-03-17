const fs = require('fs');
const p = 'src/pages/SearchResults.tsx';
let c = fs.readFileSync(p, 'utf8');

const oldStr = `            <Search size={16} className="text-slate-500" />
            <input
              ref={inputRef}
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
              placeholder="ابحث عن منتج..."
              className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={submitSearch}
              className="text-xs font-bold text-primary"
            >
              بحث
            </button>`;

const newStr = `            <Search size={16} className="text-slate-500" />
            <input
              ref={inputRef}
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
              placeholder="ابحث عن منتج..."
              className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400"
            />
            {queryInput && (
              <button
                type="button"
                onClick={() => {
                  setQueryInput('');
                  if (inputRef.current) inputRef.current.focus();
                }}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            )}
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
            <label className="p-1 cursor-pointer text-slate-500 hover:text-primary transition-colors">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  
                  try {
                    setLoading(true);
                    setResults([]);
                    setError(null);
                    setHasMore(false);
                    setActiveQuery('بحث بالصورة');
                    setQueryInput('بحث بالصورة');
                    
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                      try {
                        const base64 = event.target?.result;
                        const data = await searchProductsByImage(base64, 1, 20);
                        setResults(data.products || []);
                        setHasMore(data.hasMore);
                        setPage(1);
                      } catch (err) {
                        setError(err.message || 'حدث خطأ أثناء البحث بالصورة');
                      } finally {
                        setLoading(false);
                      }
                    };
                    reader.readAsDataURL(file);
                  } catch (err) {
                    setError('فشل في قراءة الصورة');
                    setLoading(false);
                  }
                }}
              />
              <Camera size={18} />
            </label>
            <button
              type="button"
              onClick={submitSearch}
              className="text-xs font-bold text-primary mr-1"
            >
              بحث
            </button>`;

if (c.includes(oldStr)) {
  c = c.replace(oldStr, newStr);
  fs.writeFileSync(p, c);
  console.log('updated');
} else {
  console.log('could not find string to replace');
}