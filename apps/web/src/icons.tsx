/** Ícones de traço fino (1,5), desenhados para o sistema; só na navegação e nas ações principais. */
const PATHS = {
  home: 'M3.5 10.2 12 3.8l8.5 6.4V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z',
  docs: 'M9 3.5h6.5L20 8v10.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 9 3.5zM15.5 3.5V8H20M4 7.5v12A1.5 1.5 0 0 0 5.5 21h9',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8M12 7.5V12l3 2',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.3 3.2-5.5 6.5-5.5s5.9 2.2 6.5 5.5M16 4.2a3.5 3.5 0 0 1 0 6.6M18.2 14.6c1.8.8 2.9 2.6 3.3 5.4',
  sliders:
    'M4 6.5h5M13 6.5h7M13 6.5a2 2 0 1 0-4 0a2 2 0 1 0 4 0M4 12h2M10 12h10M10 12a2 2 0 1 0-4 0a2 2 0 1 0 4 0M4 17.5h9M17 17.5h3M17 17.5a2 2 0 1 0-4 0a2 2 0 1 0 4 0',
  shield: 'M12 3.5 19 6.2v5.3c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6.2zM9 12l2.2 2.2L15.2 10',
  bell: 'M6.5 16.5v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14zM10 20.5a2.2 2.2 0 0 0 4 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8',
  logout: 'M10 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h4M14.5 8l4 4-4 4M18.5 12H9.5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.3 15.3 20 20',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  upload: 'M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4.5h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  pen: 'M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17zM14 7.6l2.9 2.9',
  alert: 'M12 4.2 21 19.5H3zM12 10v4.2M12 17.2v.3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.6v.3',
  seal: 'M12 15.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM9.8 10.2l1.6 1.6 2.8-2.9M9 15l-1.5 5.5 4.5-2 4.5 2L15 15',
  doc: 'M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5M8.5 13h7M8.5 16.5h5',
  filePlus: 'M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5zM13.5 3.5v5h5M12 11.5v6M9 14.5h6',
  zip: 'M4.5 7.5 12 3.5l7.5 4v9L12 20.5l-7.5-4zM4.5 7.5 12 11.5l7.5-4M12 11.5v9',
  hash: 'M5 9h15M4 15h15M10 4 8 20M16 4l-2 16',
  book: 'M5 5.5A2 2 0 0 1 7 3.5h11.5v14H7a2 2 0 0 0-2 2zM5 19.5a2 2 0 0 0 2 2h11.5v-4',
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4 6.5l1 1 2-2M4 12l1 1 2-2M4 17.5l1 1 2-2',
  menu: 'M4 7h16M4 12h16M4 17h16',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4.5v4h-4',
  user: 'M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.8 3.7-6 7.5-6s6.7 2.2 7.5 6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
