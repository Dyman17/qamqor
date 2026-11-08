// Official-source figures for the "problems" block. Each entry carries its own source link (gov.kz).
// To drop a figure that fails verification, delete its entry here: nothing else references it.
// Text lives in the locales: l.stats.<id>.n (number), .t (what it counts), .s (publisher).
export interface Stat {
  id: 1 | 2 | 3;
  href: string;
}

export const stats: Stat[] = [
  { id: 1, href: 'https://www.gov.kz/memleket/entities/qriim/press/news/details/930084?lang=ru' },
  { id: 2, href: 'https://www.gov.kz/memleket/entities/mangystau/press/news/details/803811?lang=ru' },
  { id: 3, href: 'https://www.gov.kz/memleket/entities/mangystau/press/news/details/429564' },
];
