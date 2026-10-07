import type { SVGProps } from 'react';

/* Line icons drawn for Dari on a 24px grid, 2px stroke, round caps (no icon dependency). They inherit
   the text colour and are hidden from assistive tech: the control that holds one carries the name. */

const PATHS = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v11h13V9" /><path d="M10 20v-5.5h4V20" /></>,
  building: <><path d="M4 20.5V8l8-4.5L20 8v12.5" /><path d="M2.5 20.5h19" /><path d="M9 20.5v-5h6v5" /><path d="M9 11h.01M15 11h.01" /></>,
  share: <><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5" /><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c2 .8 3.2 2.6 3.5 5.2" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  report: <><path d="M6 2.5h8.5L19 7v14.5H6z" /><path d="M14 2.5V7h5" /><path d="M9.5 17v-3M12.5 17v-5.5M15.5 17v-2" /></>,
  help: <><circle cx="12" cy="12" r="9.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.6v.6" /><path d="M12 17h.01" /></>,
  mail: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  logout: <><path d="M9.5 20.5H5.5a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h4" /><path d="M16 16.5 20.5 12 16 7.5M20.5 12H9.5" /></>,
  alert: <><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  arrowUpRight: <path d="M7 17 17 7M8.5 7H17v8.5" />,
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="17" rx="2" /><path d="M9 4.5V3h6v1.5" /><path d="M9 11h6M9 15h4" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  apartment: <><path d="M6 21.5V4a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 4v17.5" /><path d="M6 12H4a1.5 1.5 0 0 0-1.5 1.5v8h3.5M18 9h2a1.5 1.5 0 0 1 1.5 1.5v11H18" /><path d="M10 6.5h4M10 10.5h4M10 14.5h4M10 18.5h4" /></>,
  riad: <><path d="M2 21.5h20" /><path d="M4 21.5V10a8 8 0 0 1 16 0v11.5" /><path d="M9 21.5V16a3 3 0 0 1 6 0v5.5" /></>,
  house: <><path d="M3 10.5 12 3.5l9 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20.5z" /><path d="M9 22v-9h6v9" /></>,
  bed: <><path d="M2.5 4.5v16M2.5 8.5h17a2 2 0 0 1 2 2v10M2.5 16.5h19M6.5 8.5v8" /></>,
  pin: <><path d="M19.5 10c0 5.5-7.5 11.5-7.5 11.5S4.5 15.5 4.5 10a7.5 7.5 0 0 1 15 0z" /><circle cx="12" cy="10" r="2.75" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  upload: <><path d="M12 15.5V3.5M7 8l5-4.5L17 8" /><path d="M4 14.5v4A2 2 0 0 0 6 20.5h12a2 2 0 0 0 2-2v-4" /></>,
  shield: <><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...props}>
      {PATHS[name]}
    </svg>
  );
}
