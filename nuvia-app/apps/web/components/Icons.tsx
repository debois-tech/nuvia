import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p });

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></svg>;
export const BellIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 17h12l-1.5-2.2V10a4.5 4.5 0 0 0-9 0v4.8L6 17Z" /><path d="M10 20h4" /></svg>;
export const LinkIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, ...p })}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 10 18.7l1-1" /></svg>;
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 18, height: 18, ...p })}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>;
export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 14, height: 14, strokeWidth: 2, ...p })}><path d="m6 9 6 6 6-6" /></svg>;
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, strokeWidth: 2, ...p })}><path d="M12 5v14M5 12h14" /></svg>;
export const DotsIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 18, height: 18, ...p })} fill="currentColor" stroke="none"><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></svg>;
export const SparkleIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 18, height: 18, ...p })}><path d="M11 4c.7 4 2 5.3 6 6-4 .7-5.3 2-6 6-.7-4-2-5.3-6-6 4-.7 5.3-2 6-6Z" /><path d="M18 15c.3 1.6.9 2.2 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.3 2.2-.9 2.5-2.5Z" /></svg>;
export const BulbIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, ...p })}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" /></svg>;
export const ChevronUpIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base({ width: 16, height: 16, strokeWidth: 2, ...p })}><path d="m6 15 6-6 6 6" /></svg>;
export const LogoMark = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 18V6l12 12V6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
