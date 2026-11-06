/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#07070b',
        panel: '#101018',
        panel2: '#171722',
        edge: '#26263a',
        brand: {
          DEFAULT: '#ef4444',
          soft: '#f87171',
          deep: '#b91c1c',
        },
        gold: '#f5b642',
      },
      fontFamily: {
        sans: ['system-ui', 'Roboto', 'Segoe UI', 'Arial', 'Noto Sans', 'sans-serif'],
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pop: {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 260ms ease-out both',
        pop: 'pop 200ms ease-out both',
        pulseSoft: 'pulseSoft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
