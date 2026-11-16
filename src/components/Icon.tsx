/** Bộ icon nét mảnh dùng ở thanh bên và tiêu đề trang. Vẽ tay bằng SVG, không cần thư viện. */
const PATHS: Record<string, string[]> = {
  calc: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8.5 7h7v3h-7z', 'M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17.5h.01M12 17.5h.01M15.5 17.5h.01'],
  terminal: ['M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M8 21h8M12 17v4', 'M7 13l3-3 2 2 4-4'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z', 'M9 12l2 2 4-4'],
  journal: ['M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z', 'M6 3v18', 'M10 8h5M10 12h5M10 16h3'],
  chart: ['M4 4v16h16', 'M7.5 15l3.5-4 3 2.5 5-6.5'],
  bulb: ['M9 18h6M10 21h4', 'M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z'],
  sparkle: ['M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z', 'M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'],
  send: ['M21 4L3 11l6.5 2.5L12 20l3-4.5 4.5 3z', 'M9.5 13.5L21 4'],
  news: ['M4 5h13v14H6a2 2 0 0 1-2-2z', 'M17 9h3v8a2 2 0 0 1-2 2', 'M7.5 9h6M7.5 12.5h6M7.5 16h3.5'],
  coins: ['M3 7c0-1.7 2.7-3 6-3s6 1.3 6 3-2.7 3-6 3-6-1.3-6-3z', 'M3 7v5c0 1.7 2.7 3 6 3', 'M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3s-6 1.3-6 3'],
  megaphone: ['M3 11v2a1 1 0 0 0 1 1h3l8 4.5v-13L7 10H4a1 1 0 0 0-1 1z', 'M18.5 9a4 4 0 0 1 0 6', 'M7 14l1.2 5H10'],
  book: ['M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z', 'M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5'],
  gift: ['M4 11h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 7h18v4H3z', 'M12 7v14', 'M12 7c-1.5-3.5-5.5-3.5-5.5-1S9.5 7 12 7zM12 7c1.5-3.5 5.5-3.5 5.5-1S14.5 7 12 7z'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  palette: ['M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.9 17 3 12 3z', 'M7.5 11h.01M10 7.5h.01M14.5 7.5h.01'],
}

export type IconName = keyof typeof PATHS

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}
