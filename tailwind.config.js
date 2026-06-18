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
        serif: ['Fraunces', 'Newsreader', 'Georgia', 'Times New Roman', 'serif'],
        mono: ['IBM Plex Mono', 'DM Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        body: ['IBM Plex Sans', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        accent: 'var(--shadow-accent)',
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
