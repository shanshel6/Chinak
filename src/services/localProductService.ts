
const LOCAL_DRAFTS_KEY = 'admin_local_drafts';

export interface LocalProduct {
  id: string; // prefixed with 'local-'
  name: string;
  chineseName?: string;
  description?: string;
  price: number;
  basePriceRMB?: number;
  image?: string;
  status: 'DRAFT';
  isActive: boolean;
  isFeatured: boolean;
  isLocal: boolean;
  purchaseUrl?: string;
  videoUrl?: string;
  specs?: any;
  storeEvaluation?: any;
  options?: any[];
  variants?: any[];
  images?: any[];
  detailImages?: any[];
  createdAt: string;
  updatedAt: string;
}

export const localProductService = {
  getAllDrafts: (): LocalProduct[] => {
    const stored = localStorage.getItem(LOCAL_DRAFTS_KEY);
    if (!stored) return [];
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse local drafts:', e);
      return [];
    }
  },

  saveDraft: (product: Partial<LocalProduct>): LocalProduct => {
    const drafts = localProductService.getAllDrafts();
    const now = new Date().toISOString();
    
    let updatedProduct: LocalProduct;
    
    if (product.id && product.id.startsWith('local-')) {
      // Update existing
      const index = drafts.findIndex(d => d.id === product.id);
      if (index !== -1) {
        updatedProduct = {
          ...drafts[index],
          ...product,
          updatedAt: now,
          status: 'DRAFT', // Ensure status remains DRAFT
          isLocal: true
        } as LocalProduct;
        drafts[index] = updatedProduct;
      } else {
        // ID provided but not found, create new
        updatedProduct = {
          ...product,
          id: `local-${Date.now()}`,
          createdAt: now,
          updatedAt: now,
          status: 'DRAFT',
          isLocal: true
        } as LocalProduct;
        drafts.push(updatedProduct);
      }
    } else {
      // Create new
      updatedProduct = {
        ...product,
        id: `local-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
        status: 'DRAFT',
        isLocal: true
      } as LocalProduct;
      drafts.push(updatedProduct);
    }

    localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(drafts));
    return updatedProduct;
  },

  deleteDraft: (id: string): void => {
    const drafts = localProductService.getAllDrafts();
    const filtered = drafts.filter(d => d.id !== id);
    localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(filtered));
  },

  getDraftById: (id: string): LocalProduct | undefined => {
    return localProductService.getAllDrafts().find(d => d.id === id);
  }
};
