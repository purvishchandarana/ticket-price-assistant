export const CATEGORIES = [
  { id: 'concerts', label: 'Concerts' },
  { id: 'sports', label: 'Sports' },
  { id: 'theatre', label: 'Theatre' },
];

export const isCategory = (id) => CATEGORIES.some((c) => c.id === id);
