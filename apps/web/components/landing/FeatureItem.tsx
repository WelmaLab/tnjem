/* profs-v2 · A — « Tout ce dont tu as besoin pour enseigner »: FeatureGrid is the
   <ul> (five columns with dividers on a desktop, two on a tablet, one on a phone),
   FeatureItem one <li>: a tinted tile, the title (h3), one short text. Not
   interactive, so no hover. Server components. */
import type { ReactNode } from "react";
import "./kit.css";

const TONE = {
  blue: "lk-tone-blue",
  teal: "lk-tone-teal",
  green: "lk-tone-green",
  violet: "lk-tone-violet",
} as const;

export function FeatureGrid({ children, dataE2e }: { children: ReactNode; dataE2e?: string }) {
  return (
    <ul className="lk-features" data-e2e={dataE2e}>
      {children}
    </ul>
  );
}

export function FeatureItem({
  icon,
  tone,
  title,
  text,
}: {
  icon: ReactNode;
  tone: "blue" | "teal" | "green" | "violet";
  title: string;
  text: string;
}) {
  return (
    <li className="lk-feature">
      <span className={`lk-tile lk-feature-tile ${TONE[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <h3 className="lk-feature-title">{title}</h3>
      <p className="lk-feature-text">{text}</p>
    </li>
  );
}
