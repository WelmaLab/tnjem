/* profs-v2 · A — « Tu enseignes à titre individuel ou au sein d'un centre ? »: one
   choice. The WHOLE card is one link, so nothing inside may be a control. mailto:,
   tel: and http(s) hrefs (or `external`) are a plain <a>; the rest go through
   components/Link for the locale prefix. `pill` is the system's « soon » tag
   (ochre, clock), never a green « Nouveau »: it is part of the link's name.
   Server component. */
import type { ReactNode } from "react";
import { Link } from "@/components/Link";
import { Tag } from "@/components/ui";
import { IconArrow } from "./landing-icons";
import "./kit.css";

const ACCENT = { blue: "lk-role-blue", ochre: "lk-role-ochre" } as const;
const TILE = { blue: "lk-tone-blue", ochre: "lk-tone-ochre" } as const;

export function RoleChoiceCard({
  href,
  external,
  icon,
  title,
  text,
  pill,
  accent,
  dataE2e,
}: {
  href: string;
  external?: boolean;
  icon: ReactNode;
  title: string;
  text: string;
  pill?: string;
  accent: "blue" | "ochre";
  dataE2e?: string;
}) {
  const body = (
    <>
      <span className={`lk-tile lk-role-tile ${TILE[accent]}`} aria-hidden="true">
        {icon}
      </span>
      <span className="lk-role-main">
        <span className="lk-role-title">{title}</span>
        <span className="lk-role-text">{text}</span>
      </span>
      <IconArrow className="lk-role-arrow" />
      {pill && (
        <Tag kind="soon" className="lk-role-pill">
          {pill}
        </Tag>
      )}
    </>
  );
  const className = `lk-role ${ACCENT[accent]}`;
  return external || /^(mailto:|tel:|https?:)/i.test(href) ? (
    <a href={href} className={className} data-e2e={dataE2e}>
      {body}
    </a>
  ) : (
    <Link href={href} className={className} data-e2e={dataE2e}>
      {body}
    </Link>
  );
}
