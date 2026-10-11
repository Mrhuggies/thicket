// Small stroke icons (24×24 grid).
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  logo: `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="var(--accent)"/><path d="M16 6l7 12h-4l4 7H9l4-7H9z" fill="var(--panel)"/></svg>`,
  play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
  step: svg('<path d="M6 5l9 7-9 7z" fill="currentColor"/><path d="M18 5v14" stroke-width="2.4"/>'),
  inspect: svg('<path d="M5 3l6 16 2.5-6.5L20 10z"/>'),
  release: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>'),
  cull: svg('<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>'),
  fire: svg('<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 1.5 2 2 2 0-3 0-5 1-7z"/>'),
  rain: svg('<path d="M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A3.5 3.5 0 0 1 17 15z"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/>'),
  fear: svg('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
  dna: svg('<path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12"/><path d="M8.5 7h7M8.5 17h7"/>'),
  share: svg('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  theme: svg('<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor"/>'),
  drought: svg('<circle cx="12" cy="9" r="4"/><path d="M12 1.5v2M4.5 9h-2M21.5 9h-2M6.5 3.5l1.4 1.4M17.5 3.5l-1.4 1.4"/><path d="M3 20l4-3 3 2 4-4 3 3 4-2"/>'),
  poison: svg('<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/><path d="M9.5 12.5l5 5M14.5 12.5l-5 5"/>'),
  bug: svg('<ellipse cx="12" cy="13" rx="4.5" ry="6"/><path d="M12 7V4M9 5L7 3M15 5l2-2M7.5 11H3M21 11h-4.5M7.5 15H4M20 15h-3.5M12 7v12"/>'),
  plant: svg('<path d="M12 21v-9"/><path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 14c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/>'),
  wall: svg('<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M3 12h18M9 6v6M15 12v6"/>'),
  virus: svg('<circle cx="12" cy="12" r="5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M4.9 4.9l3.5 3.5M15.6 15.6l3.5 3.5M4.9 19.1l3.5-3.5M15.6 8.4l3.5-3.5"/>'),
  berry: svg('<circle cx="8" cy="15" r="3.5"/><circle cx="15.5" cy="15.5" r="3.5"/><circle cx="12" cy="9.5" r="3.5"/><path d="M12 6c0-2 1.5-3 3.5-3"/>'),
  dam: svg('<path d="M3 8c3-2 6 2 9 0s6-2 9 0"/><path d="M4 13h16M5 17h14M4 13l1 4M20 13l-1 4M9 13v4M15 13v4"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  clip: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>'),
  target: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
};
