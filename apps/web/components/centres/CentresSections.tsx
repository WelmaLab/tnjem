import { Tag } from "@/components/ui";
import type { AppLocale } from "@/lib/locale";
import {
  IconCalendar,
  IconChart,
  IconPencil,
  IconShare,
  IconShieldCheck,
  IconVideo,
  IconWallet,
} from "@/components/landing/landing-icons";
import { pageCopy } from "./centres-copy";
import { centrePoints, packsView, type PointIcon } from "./centres-offer";
import "@/components/landing/kit.css";
import "./centres.css";

/* december-sprint · B (D12) — the key points, « À savoir » and the packs.
   Server components; every switch is read through ./centres-offer.ts. */

const ICON: Record<PointIcon, typeof IconPencil> = {
  settings: IconPencil,
  qr: IconShare,
  video: IconVideo,
  chart: IconChart,
  wallet: IconWallet,
  bell: IconCalendar,
};
const TONE: Record<PointIcon, string> = {
  settings: "lk-tone-blue",
  qr: "lk-tone-teal",
  video: "lk-tone-blue",
  chart: "lk-tone-violet",
  wallet: "lk-tone-ochre",
  bell: "lk-tone-teal",
};

export function CentresPoints({ locale }: { locale: AppLocale }) {
  const c = pageCopy[locale];
  const points = centrePoints(locale);
  return (
    <section className="ce-sec" aria-labelledby="ce-points-title" data-e2e="centres-points">
      <div className="container">
        <h2 id="ce-points-title" className="web-h2 ce-h2">{c.pointsTitle}</h2>
        <ul className="ce-points">
          {points.map(({ text, icon }) => {
            const Icon = ICON[icon];
            return (
              <li key={icon} className="ce-point" data-point={icon}>
                <span className={`lk-tile ce-point-tile ${TONE[icon]}`} aria-hidden="true">
                  <Icon />
                </span>
                <p>{text}</p>
              </li>
            );
          })}
        </ul>
        <div className="ce-know" data-e2e="centres-know">
          <span className="ce-know-ic" aria-hidden="true">
            <IconShieldCheck />
          </span>
          <div>
            <p className="ce-know-title">{c.knowTitle}</p>
            <p>{c.know}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CentresPacks({ locale }: { locale: AppLocale }) {
  const c = pageCopy[locale];
  const { packs, onRequest } = packsView(locale);
  return (
    <section className="ce-sec ce-band" aria-labelledby="ce-packs-title" data-e2e="centres-packs">
      <div className="container">
        <h2 id="ce-packs-title" className="web-h2 ce-h2">{c.packsTitle}</h2>
        <ul className="ce-packs">
          {packs.map((p) => (
            <li key={p.code} className="ce-pack" data-pack={p.code}>
              <h3 className="ce-pack-name">{p.name}</h3>
              {p.cap && <Tag className="ce-pack-cap">{p.cap}</Tag>}
              {p.price && <p className="ce-pack-price" data-e2e="centres-pack-price">{p.price}</p>}
            </li>
          ))}
        </ul>
        {onRequest && <p className="ce-onrequest" data-e2e="centres-on-request">{onRequest}</p>}
      </div>
    </section>
  );
}
