/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('daisyui'),
  ],
  daisyui: {
    themes: [
      {
        wood: {
          "primary": "#8b5a2b",      /* Earthy brown for the toggle switch */
          "secondary": "#a0522d",
          "accent": "#cd853f",
          "neutral": "#3d2b1f",      /* Dark brown for text and avatar background */
          "base-100": "#f5deb3",     /* Wheat/Light wood for card backgrounds */
          "base-200": "#e6c280",     /* Slightly darker for menu lists */
          "base-300": "#d2b48c",     /* Tan for the main screen background */
        },
        cyber: {
          "primary": "#00ff9f",      /* Neon mint toggle */
          "secondary": "#00b8ff",
          "accent": "#ff00ff",
          "neutral": "#0f0f13",      /* Deep space text/avatar */
          "base-100": "#1a1b26",     /* Dark navy cards */
          "base-200": "#24283b",     /* Slightly lighter navy lists */
          "base-300": "#16161e",     /* Deepest background */
        },
        canopy: {
          "primary": "#22c55e",      /* Vibrant green toggle */
          "secondary": "#15803d",
          "accent": "#84cc16",
          "neutral": "#1c1917",      /* Bark-like dark text */
          "base-100": "#f0fdf4",     /* Crisp white-green cards */
          "base-200": "#dcfce7",     /* Soft green lists */
          "base-300": "#bbf7d0",     /* Lush green background */
        },
        apiary: {
          "primary": "#f59e0b",      /* Golden amber toggle */
          "secondary": "#d97706",
          "accent": "#fbbf24",
          "neutral": "#27272a",      /* Charcoal text */
          "base-100": "#fffbeb",     /* Warm cream cards */
          "base-200": "#fef3c7",     /* Light honey lists */
          "base-300": "#fde68a",     /* Rich yellow background */
        }
      },
    ],
  },
}
