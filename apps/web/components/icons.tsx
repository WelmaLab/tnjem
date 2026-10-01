// Tnajem icon set (inline SVG, line style). Use: <Star className="..."/>. Agents may add more here if needed.
import type { ReactNode, CSSProperties } from "react";
type P = { className?: string; style?: CSSProperties };
const S = ({ children, className, style }: { children: ReactNode } & P) => (
  <svg viewBox="0 0 24 24" className={`ic ${className ?? ""}`} style={style} aria-hidden="true">{children}</svg>
);
export const Back = (p: P) => <S className={`flip ${p.className ?? ""}`} style={p.style}><polyline points="15 18 9 12 15 6" /></S>;
export const Forward = (p: P) => <S className={`flip ${p.className ?? ""}`} style={p.style}><polyline points="9 6 15 12 9 18" /></S>;
// Auth Option B: the arrow after a <select> inside .inp (className="inp-chev"). Vertical, so never flipped.
export const ChevronDown = (p: P) => <S {...p}><polyline points="6 9 12 15 18 9" /></S>;
export const Share = (p: P) => <S {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></S>;
export const Copy = (p: P) => <S {...p}><rect x="9" y="9" width="11" height="11" rx="2.4" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></S>;
export const Gear = (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.4-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V10a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" /></S>;
// Phase A+ (U1): the icon of a .note-info — information, not a guarantee (Shield) or a success (Check).
export const Info = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="7.8" x2="12" y2="8" /></S>;
export const Lock = (p: P) => <S {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.4" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></S>;
export const Shield = (p: P) => <S {...p}><path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><polyline points="9 12 11.3 14.3 15.3 10" /></S>;
export const Check = (p: P) => <S {...p}><polyline points="5 13 10 18 19 7" /></S>;
export const Play = (p: P) => <S className={`fill ${p.className ?? ""}`} style={p.style}><path d="M8 5.5v13l11-6.5-11-6.5z" /></S>;
export const Calendar = (p: P) => <S {...p}><rect x="4" y="5.5" width="16" height="15" rx="2.6" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="8.5" y1="3" x2="8.5" y2="7" /><line x1="15.5" y1="3" x2="15.5" y2="7" /></S>;
export const Clock = (p: P) => <S {...p}><circle cx="12" cy="12" r="8" /><polyline points="12 7.5 12 12 15 14" /></S>;
export const Users = (p: P) => <S {...p}><path d="M16 19v-1.4a3.4 3.4 0 0 0-3.4-3.4H7.4A3.4 3.4 0 0 0 4 17.6V19" /><circle cx="10" cy="8" r="3.2" /><path d="M19.5 19v-1.4a3.4 3.4 0 0 0-2.4-3.3" /><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6" /></S>;
export const Star = (p: P) => <S {...p}><path d="M12 3.6l2.6 5.2 5.8.9-4.2 4.1 1 5.7L12 16.8 6.8 19.5l1-5.7L3.6 9.7l5.8-.9L12 3.6z" /></S>;
export const Gift = (p: P) => <S {...p}><path d="M20 8.5H4V12h16V8.5z" /><path d="M5.5 12v7.5h13V12" /><line x1="12" y1="8.5" x2="12" y2="19.5" /><path d="M12 8.5S11 4.2 8.7 4.9 9 8.5 12 8.5z" /><path d="M12 8.5s.9-4.3 3.2-3.6S15 8.5 12 8.5z" /></S>;
export const Video = (p: P) => <S {...p}><rect x="3.5" y="6.5" width="12" height="11" rx="2.6" /><path d="M15.5 10l5-3v10l-5-3" /></S>;
export const Mic = (p: P) => <S {...p}><rect x="9.5" y="3" width="5" height="11" rx="2.5" /><path d="M6 11a6 6 0 0 0 12 0" /><line x1="12" y1="17" x2="12" y2="20.5" /></S>;
export const Bell = (p: P) => <S {...p}><path d="M18 9a6 6 0 1 0-12 0c0 6-2.4 7-2.4 7h16.8S18 15 18 9z" /><path d="M10.4 20a2 2 0 0 0 3.2 0" /></S>;
export const Wallet = (p: P) => <S {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v2.5" /><rect x="3.5" y="7" width="17" height="12.5" rx="2.6" /><circle cx="16.4" cy="13.2" r="1.5" className="fill" /></S>;
export const ArrowUR = (p: P) => <S className={`flip ${p.className ?? ""}`} style={p.style}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="8 7 17 7 17 16" /></S>;
export const Plus = (p: P) => <S {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></S>;
export const Trend = (p: P) => <S {...p}><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></S>;
export const Home = (p: P) => <S {...p}><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></S>;
export const Search = (p: P) => <S {...p}><circle cx="11" cy="11" r="6" /><line x1="20" y1="20" x2="15.6" y2="15.6" /></S>;
export const Chat = (p: P) => <S {...p}><path d="M5.5 5h13a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 18.5 16H10l-4.2 3.4V6.5A1.5 1.5 0 0 1 5.5 5z" /></S>;
export const Mail = (p: P) => <S {...p}><rect x="3" y="5" width="18" height="14" rx="2.2" /><path d="M3.6 7.2 12 13l8.4-5.8" /></S>;
export const User = (p: P) => <S {...p}><circle cx="12" cy="8" r="3.6" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></S>;
export const Eye = (p: P) => <S {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></S>;
export const Bulb = (p: P) => <S {...p}><path d="M9.5 17h5M10 20h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8h5c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></S>;
export const Bolt = (p: P) => <S {...p}><path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z" /></S>;
export const Phone = (p: P) => <S {...p}><path d="M6 3h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z" /></S>;
export const Board = (p: P) => <S {...p}><rect x="3.5" y="4" width="17" height="13" rx="2.2" /><path d="M8 21l4-4 4 4" /><path d="M7.5 8.5h7" /><path d="M7.5 12h9" /></S>;
export const Quiz = (p: P) => <S {...p}><rect x="4.5" y="3.5" width="15" height="17" rx="2.4" /><path d="M9.4 9.3a2.6 2.6 0 1 1 3.4 2.6c-.8.3-1.3.9-1.3 1.7" /><circle cx="11.6" cy="16.4" r="0.7" className="fill" /></S>;
export const Book = (p: P) => <S {...p}><path d="M12 6.6C10.4 5.1 7.8 4.6 4 5.2v12.6c3.8-.6 6.4-.1 8 1.4 1.6-1.5 4.2-2 8-1.4V5.2c-3.8-.6-6.4-.1-8 1.4z" /><path d="M12 6.6v12.6" /></S>;
export const Box = (p: P) => <S {...p}><path d="M3.6 7.5 12 3l8.4 4.5v9L12 21l-8.4-4.5z" /><path d="M3.6 7.5 12 12l8.4-4.5" /><path d="M12 12v9" /></S>;
export const Upload = (p: P) => <S {...p}><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></S>;
export const Bank = (p: P) => <S {...p}><path d="M12 3l8.5 5H3.5z" /><path d="M5 11v6M9.5 11v6M14.5 11v6M19 11v6" /><path d="M3.5 20.5h17" /></S>;
// espace prof v2 · shell — the AppShell's nav (Abonnements, Promotions, Ma vitrine), the avatar menu and the date picker.
export const Repeat = (p: P) => <S {...p}><path d="M17 2.5l3 3-3 3" /><path d="M4 11.5V10a4.5 4.5 0 0 1 4.5-4.5H20" /><path d="M7 21.5l-3-3 3-3" /><path d="M20 12.5V14a4.5 4.5 0 0 1-4.5 4.5H4" /></S>;
export const Percent = (p: P) => <S {...p}><line x1="18.5" y1="5.5" x2="5.5" y2="18.5" /><circle cx="7" cy="7" r="2.4" /><circle cx="17" cy="17" r="2.4" /></S>;
export const Store = (p: P) => <S {...p}><path d="M4 9.5 5.6 4.5h12.8L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" /><path d="M5.5 12v8h13v-8" /><path d="M10 20v-4.5h4V20" /></S>;
export const LogOut = (p: P) => <S className={`flip ${p.className ?? ""}`} style={p.style}><path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5" /><polyline points="15.5 16.5 20 12 15.5 7.5" /><line x1="20" y1="12" x2="9.5" y2="12" /></S>;
export const Help = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6" /><circle cx="12" cy="16.6" r=".6" className="fill" /></S>;
export const ChevronUp = (p: P) => <S {...p}><polyline points="6 15 12 9 18 15" /></S>;
export const Chain = (p: P) => <S {...p}><path d="M10 13.5a4 4 0 0 0 5.7.3l2.9-2.9a4 4 0 0 0-5.7-5.7l-1.4 1.4" /><path d="M14 10.5a4 4 0 0 0-5.7-.3l-2.9 2.9a4 4 0 0 0 5.7 5.7l1.4-1.4" /></S>;
export const Close = (p: P) => <S {...p}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></S>;
