/* profs-v2 · A — the closing pilot banner: the rocket, the title (h2), the checks, a
   vertical divider, the white button. It is the inner card: the caller owns the
   <section>. Wrap the figure of `title` in <b> and it takes the accent colour.

   `dataE2e` marks the card; the button gets the same value + « -cta »
   (profs-banner → profs-banner-cta). Server component. */
import type { ReactNode } from "react";
import { Link } from "@/components/Link";
import { IconCheck as Check } from "./landing-icons";
import { IconArrow } from "./landing-icons";
import "./kit.css";

/* Our own drawing, no third-party asset. Decorative. The clouds bleed off the card's
   corner, and on a phone, where the rocket rides beside the title, they are hidden. */
function RocketArt() {
  return (
    <svg viewBox="0 0 200 160" className="lk-rocket" aria-hidden="true" focusable="false">
      <g className="lk-rocket-sky" fill="var(--paper)">
        <circle cx="26" cy="146" r="30" />
        <circle cx="66" cy="152" r="26" />
        <circle cx="100" cy="162" r="20" />
        <circle cx="-4" cy="128" r="24" />
      </g>
      <g transform="translate(108 76) rotate(42) scale(1.2)">
        <path d="M-8.5 30C-11 44-4.5 54 0 66 4.5 54 11 44 8.5 30z" fill="var(--ochre300)" />
        <path d="M-4 30C-5 38-2 44 0 50 2 44 5 38 4 30z" fill="var(--amber)" />
        <path d="M-18 4-37 28c-3 4 0 8 4 6l17-9zM18 4l19 24c3 4 0 8-4 6l-17-9z" fill="var(--ochre)" />
        <path d="M0-62C19-44 24-14 18 26h-36C-24-14-19-44 0-62z" fill="var(--paper)" />
        <path d="M0-62C19-44 24-14 18 26H0z" fill="var(--blue100)" />
        <path d="M0-62C8-54 13-45 16.4-35h-32.8C-13-45-8-54 0-62z" fill="var(--ochre)" />
        <rect x="-12" y="26" width="24" height="6" rx="2.4" fill="var(--ochre600)" />
        <circle cy="-11" r="11.5" fill="var(--blue700)" />
        <circle cy="-11" r="7.5" fill="var(--blue300)" />
        <path d="M-4-13a4.6 4.6 0 0 1 4-3.6" fill="none" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round" />
      </g>
      <g fill="var(--on-blue-soft)">
        <circle cx="42" cy="44" r="2.4" />
        <circle cx="72" cy="20" r="1.6" />
        <circle cx="176" cy="96" r="2" />
      </g>
    </svg>
  );
}

export function PilotBanner({
  title,
  checks,
  ctaLabel,
  ctaHref,
  dataE2e,
}: {
  title: ReactNode;
  checks: string[];
  ctaLabel: string;
  ctaHref: string;
  dataE2e?: string;
}) {
  return (
    <div className="lk-banner" data-e2e={dataE2e}>
      <div className="lk-banner-art">
        <RocketArt />
      </div>
      <div className="lk-banner-body">
        <h2 className="lk-banner-title">{title}</h2>
        <ul className="lk-banner-checks">
          {checks.map((label) => (
            <li key={label}>
              <span className="lk-banner-tick" aria-hidden="true">
                <Check />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>
      <div className="lk-banner-action">
        <Link href={ctaHref} className="lk-banner-cta" data-e2e={dataE2e ? `${dataE2e}-cta` : undefined}>
          {ctaLabel}
          <IconArrow className="lk-banner-cta-ic" />
        </Link>
      </div>
    </div>
  );
}
