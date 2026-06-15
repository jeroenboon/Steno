/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--color-base)',
        surface: {
          0: 'var(--color-surface-0)',
          1: 'var(--color-surface-1)',
          2: 'var(--color-surface-2)',
          3: 'var(--color-surface-3)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          dim: 'var(--color-border-dim)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          dim: 'var(--color-accent-dim)',
          glow: 'var(--color-accent-glow)',
          muted: 'var(--color-accent-muted)',
        },
        live: 'var(--color-live)',
        confirmed: 'var(--color-confirmed)',
        proposed: 'var(--color-proposed)',
        dismissed: 'var(--color-dismissed)',
        danger: 'var(--color-danger)',
        nudge: 'var(--color-nudge)',
        tx: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          accent: 'var(--color-text-accent)',
          inverted: 'var(--color-text-inverted)',
        },
      },
      fontFamily: {
        mono: ['DM Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
        body: ['Geist', 'IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['11px', { lineHeight: '1.4' }],
        sm: ['12px', { lineHeight: '1.5' }],
        base: ['13px', { lineHeight: '1.5' }],
        md: ['14px', { lineHeight: '1.5' }],
        lg: ['16px', { lineHeight: '1.4' }],
        xl: ['20px', { lineHeight: '1.3' }],
        '2xl': ['26px', { lineHeight: '1.2' }],
        '3xl': ['34px', { lineHeight: '1.1' }],
      },
      borderRadius: {
        sm: '3px',
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
        pill: '999px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.4)',
        md: '0 4px 12px rgba(0,0,0,0.5)',
        lg: '0 8px 24px rgba(0,0,0,0.6)',
        accent: '0 0 0 1px var(--color-accent), 0 0 12px var(--color-accent-glow)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        normal: '220ms',
        slow: '380ms',
      },
    },
  },
  plugins: [],
}
