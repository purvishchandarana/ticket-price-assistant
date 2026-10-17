export const CATEGORIES = [
  { id: 'concerts', label: 'Concerts' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'sports', label: 'Sports' },
  { id: 'theatre', label: 'Theatre' },
];

export const isCategory = (id) => CATEGORIES.some((c) => c.id === id);
