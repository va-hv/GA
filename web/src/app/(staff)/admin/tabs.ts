// The admin console's sections (shared by the server page and the client console).
export const TABS = [
  { id: 'overview', text: 'Overview' },
  { id: 'people', text: 'People' },
  { id: 'kiosks', text: 'Kiosks' },
  { id: 'site', text: 'Site settings' },
  { id: 'sessions', text: 'Signed in' },
  { id: 'history', text: 'History' },
  { id: 'export', text: 'Export' },
] as const;
export type Tab = (typeof TABS)[number]['id'];
