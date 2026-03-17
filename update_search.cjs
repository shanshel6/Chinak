const fs = require('fs');
const p = 'src/pages/SearchResults.tsx';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/import \{ AlertCircle, Search, ArrowRight \} from 'lucide-react';/, "import { AlertCircle, Search, ArrowRight, Camera, X } from 'lucide-react';");
c = c.replace(/import \{ searchProducts \} from '\.\.\/services\/api';/, "import { searchProducts, searchProductsByImage } from '../services/api';");
fs.writeFileSync(p, c);
