/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 胖东来红主色
        primary: '#C8102E',
        // 浅灰背景
        base: '#F5F5F5',
      },
      fontFamily: {
        sans: ['"PingFang SC"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
