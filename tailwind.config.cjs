/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "primary": "#2b8cee",
        "background-light": "#f6f7f8",
        "background": "#f6f7f8", // Alias for background-light
        "background-dark": "#0f172a",
        "surface-light": "#ffffff",
        "surface": "#ffffff", // Alias for surface-light
        "surface-dark": "#1e293b",
        "border-light": "#dbe0e6",
        "border": "#dbe0e6", // Alias for border-light
        "border-dark": "#334155",
        "card-light": "#ffffff",
        "card": "#ffffff", // Alias for card-light
        "card-dark": "#1e293b",
        "text-light": "#1e293b",
        "text-dark": "#f1f5f9",
        "text-muted-light": "#64748b",
        "text-muted-dark": "#94a3b8",
      },
      fontFamily: {
        "display": ["Cairo", "Inter", "sans-serif"]
      },
      borderRadius: {
        "DEFAULT": "0.5rem",
        "lg": "0.75rem",
        "xl": "1rem",
        "2xl": "1.5rem",
        "full": "9999px"
      },
      animation: {
        'bounce-slow': 'bounce 3s infinite',
        'scale-in': 'scaleIn 0.5s ease-out forwards'
      },
      keyframes: {
        scaleIn: {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        }
      },
    },
  },
  plugins: [],
}
