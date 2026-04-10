import cairosvg

svg = '''<svg viewBox="0 0 100 78" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lk-g" x1="50" y1="5" x2="50" y2="73" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#6ee7b7" />
      <stop offset="45%" stop-color="#2dd4bf" />
      <stop offset="100%" stop-color="#38bdf8" />
    </linearGradient>
  </defs>
  <path d="M 23 20 L 5 54 L 27 62 L 36 46" stroke="url(#lk-g)" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round" />
  <path d="M 77 20 L 95 54 L 73 62 L 64 46" stroke="url(#lk-g)" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round" />
  <path d="M 50 6 L 36 46 L 50 56 L 64 46 Z" stroke="url(#lk-g)" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round" />
  <path d="M 27 62 Q 38 52 50 56 Q 62 52 73 62" stroke="url(#lk-g)" stroke-width="3.8" stroke-linejoin="round" stroke-linecap="round" />
  <path d="M 50 56 L 43 64 L 50 72 L 57 64 Z" stroke="url(#lk-g)" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round" />
</svg>'''

with open('logo-marketing.png', 'wb') as f:
    f.write(cairosvg.svg2png(bytestring=svg.encode('utf-8'), output_width=1024, output_height=798))

print('logo-marketing.png created')
