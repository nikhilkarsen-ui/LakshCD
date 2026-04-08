import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        lk: {
          bg: '#0b1120', card: '#111827', hover: '#162033', border: '#1e2a3a',
          accent: '#00d4aa', 'accent-dim': 'rgba(0,212,170,0.15)',
          red: '#ff4757', 'red-dim': 'rgba(255,71,87,0.15)',
          text: '#e2e8f0', dim: '#64748b', muted: '#475569',
        },
      },
      fontFamily: { display: ['"DM Sans"', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'monospace'] },
      animation: { 'fade-in': 'fadeIn .3s ease-out', 'slide-up': 'slideUp .3s ease-out' },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
export default config;
