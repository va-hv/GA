// Hand-drawn icons (no icon library). 24x24, stroke uses currentColor.
import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});

/** The boom barrier: Gatehouse's mark. */
export const Barrier = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="13" width="4" height="8" rx="1" /><path d="M6 15 L22 9" strokeWidth="3" /><path d="M10 13.5 l1.6 -0.6 M15 11.7 l1.6 -0.6" stroke="var(--signal)" strokeWidth="3" /></svg>
);
export const Truck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2 6h11v10H2z" /><path d="M13 9h4l4 4v3h-8z" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>
);
export const Person = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></svg>
);
export const Hardhat = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 17h18" /><path d="M5 17a7 7 0 0 1 14 0" /><path d="M10 10V6h4v4" /></svg>
);
export const Dock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 21V8l9-5 9 5v13" /><path d="M7 21v-8h10v8" /><path d="M7 16h10" /></svg>
);
export const Key = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></svg>
);
export const Tablet = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M11 18h2" /></svg>
);
export const Arrow = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const Check = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 12l5 5L20 6" /></svg>
);
export const Moon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>
);
export const Sun = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const Camera = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13" r="4" /></svg>
);
