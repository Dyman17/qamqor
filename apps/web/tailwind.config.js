/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: '#064e3b',     // Deep emerald green
          primary: '#047857',  // Nature forest green
          accent: '#10b981',   // Bright pasture green
          light: '#ecfdf5',    // Mint soft bg
          gold: '#d97706',     // Steppe gold / amber
          goldLight: '#fef3c7',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

