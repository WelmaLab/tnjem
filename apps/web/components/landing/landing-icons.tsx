/* profs-v2 · A — the icon names of the landing kit. Same stroke style as
   components/icons.tsx (24 viewBox, the .ic class's 1.85 round stroke), and where
   that set already has the drawing this name IS that drawing. The new ones are
   ours. Decorative (aria-hidden); a label always sits beside them. Server-safe. */
import type { CSSProperties, ReactNode } from "react";

export {
  User as IconPerson,
  Calendar as IconCalendar,
  Video as IconVideo,
  Users as IconUsers,
  Shield as IconShieldCheck,
} from "@/components/icons";

type P = { className?: string; style?: CSSProperties };

const S = ({ children, className, style }: { children: ReactNode } & P) => (
  <svg viewBox="0 0 24 24" className={`ic ${className ?? ""}`} style={style} aria-hidden="true">
    {children}
  </svg>
);

export function IconBuilding(p: P) {
  return (
    <S {...p}>
      <path d="M4.5 20.5V6.2a1.7 1.7 0 0 1 1.7-1.7h6.6a1.7 1.7 0 0 1 1.7 1.7v14.3" />
      <path d="M14.5 10.5h3.3a1.7 1.7 0 0 1 1.7 1.7v8.3" />
      <path d="M3 20.5h18" />
      <path d="M8 8.5h3M8 12h3M8 15.5h3" />
    </S>
  );
}

export function IconChart(p: P) {
  return (
    <S {...p}>
      <rect x="4.5" y="13.5" width="3.6" height="7" rx="1.2" />
      <rect x="10.2" y="9" width="3.6" height="11.5" rx="1.2" />
      <rect x="15.9" y="4" width="3.6" height="16.5" rx="1.2" />
    </S>
  );
}

export function IconRocket(p: P) {
  return (
    <S {...p}>
      <path d="M14 15.8 8.2 10c1.6-3.9 5-6.6 11.8-6.5.1 6.8-2.6 10.2-6 12.3z" />
      <circle cx="15" cy="9" r="1.6" />
      <path d="M8.9 10.7 4.7 11l2.4-3.2 3.2-.5" />
      <path d="m13.3 15.1-.3 4.2 3.2-2.4.5-3.2" />
      <path d="M6.6 15.9c-1.5.6-2.2 2-2.3 3.8 1.8-.1 3.2-.8 3.8-2.3" />
    </S>
  );
}

export function IconCheckCircle(p: P) {
  return (
    <S {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="8 12.4 10.8 15.2 16 9.4" />
    </S>
  );
}

/** Points to the inline END: drawn towards the right, and .flip mirrors it in RTL.
    To nudge it on hover use the `translate` property: `transform` is .flip's. */
export function IconArrow({ className, style }: P) {
  return (
    <S className={`flip ${className ?? ""}`} style={style}>
      <line x1="4.5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </S>
  );
}
