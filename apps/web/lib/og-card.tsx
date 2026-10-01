import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

/* THE SOCIAL PREVIEW CARDS — Espace prof v2 · Phase 3.

   A tutor pastes their link into WhatsApp and this 1200×630 PNG IS the first
   thing most visitors ever see of Tnajem. One card per tutor (name, subject,
   Vérifié, the photo once a human approved it, the "à partir de" price) and one
   per class (title, tutor, date and time in Tunis, price), rendered by next/og at
   request time and cached by the route (revalidate in the opengraph-image files).

   TRUTH RULE: only what the public page itself shows. No rating, no student
   count, no "1ʳᵉ séance offerte" (a claim baked into a PNG cannot follow the
   tutor's toggle — see scripts/brand/build-og.mjs), no payment wording.

   ARABIC. Satori shapes Arabic letters correctly with an Arabic font, but it lays
   WORDS out left-to-right whatever `direction` says — so an Arabic line is
   rendered word by word in a row-reverse flex (<Line rtl>), and the AR card
   mirrors its layout with row-reverse rows. Satori has no logical properties;
   mirroring is done with flex direction only, never left/right offsets.

   FONTS ship in apps/web/assets/og (OFL, licences beside them): Space Grotesk and
   Plus Jakarta Sans as on the site, IBM Plex Sans Arabic for Arabic. TTF because
   Satori cannot read WOFF2. */

/* The design tokens the cards use, by value: Satori cannot resolve CSS custom
   properties. MIRRORS apps/web/app/globals.css — apps/api/test/ep2-og-palette.test.ts
   fails if one drifts. Every fg/bg pair below is one contrast.mjs already checks. */
export const OG_PALETTE = {
  ink: "#101F33",
  ink2: "#33445C",
  muted: "#5C6879",
  blue: "#0E5AA6",
  blue50: "#E9F1FA",
  cream: "#FBF7F0",
  paper: "#FFFFFF",
  line: "#EADFCD",
  ochre: "#E0852E",
  ochreTint: "#FFF4DF",
  ochreInk: "#995617",
  greenBtn: "#17855F",
} as const;
const P = OG_PALETTE;

export const OG_SIZE = { width: 1200, height: 630 } as const;

const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
export const hasArabic = (s: string | null | undefined) => Boolean(s && ARABIC.test(s));

async function asset(rel: string): Promise<Buffer | null> {
  try {
    return await readFile(join(process.cwd(), rel));
  } catch {
    return null;
  }
}

/** The ImageResponse options. A deploy that lost assets/og still renders a card
    (next/og's built-in font, Latin only) rather than answering 500. */
async function options() {
  const f = await fonts();
  return { ...OG_SIZE, ...(f.length ? { fonts: f } : {}) };
}

async function fonts() {
  const [grotesk, jakarta500, jakarta700, plex] = await Promise.all([
    asset("assets/og/Grotesk-700.ttf"),
    asset("assets/og/Jakarta-500.ttf"),
    asset("assets/og/Jakarta-700.ttf"),
    asset("assets/og/PlexArabic-600.ttf"),
  ]);
  const out: { name: string; data: Buffer; weight: 500 | 600 | 700; style: "normal" }[] = [];
  if (grotesk) out.push({ name: "Grotesk", data: grotesk, weight: 700, style: "normal" });
  if (jakarta500) out.push({ name: "Jakarta", data: jakarta500, weight: 500, style: "normal" });
  if (jakarta700) out.push({ name: "Jakarta", data: jakarta700, weight: 700, style: "normal" });
  if (plex) out.push({ name: "Plex", data: plex, weight: 600, style: "normal" });
  return out;
}

/** The logo as a data URI (public/logo.png), or null when the file is not there. */
async function logoUri(): Promise<string | null> {
  const buf = await asset("public/logo.png");
  return buf ? `data:image/png;base64,${buf.toString("base64")}` : null;
}

/** Arabic words one by one; a run of Latin words or numbers kept together, in its own
    left-to-right order ("مع Mohamed B." → [مع] [Mohamed B.]) — a small bidi. */
export function rtlChunks(text: string): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const last = out.length - 1;
    if (!hasArabic(w) && last >= 0 && !hasArabic(out[last])) out[last] = `${out[last]} ${w}`;
    else out.push(w);
  }
  return out;
}

/** One line of text. Arabic is laid out chunk by chunk, right to left (see the header). */
function Line({ text, size, family, weight, color, rtl }: {
  text: string; size: number; family: string; weight?: number; color: string; rtl?: boolean;
}) {
  const arabic = rtl || hasArabic(text);
  const style = { fontSize: size, fontFamily: arabic ? "Plex" : family, fontWeight: weight ?? 700, color, lineHeight: 1.2 };
  if (!arabic) return <div style={{ display: "flex", ...style }}>{text}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "row-reverse", flexWrap: "wrap", gap: size * 0.28, ...style }}>
      {rtlChunks(text).map((w, i) => <RtlWord key={i} word={w} />)}
    </div>
  );
}

const ARABIC_RUN = /([؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+)/;

/** An Arabic word with punctuation inside ("د.ت"): Satori would lay its pieces out
    left to right ("ت.د"), so the pieces are reversed too, with no gap. */
function RtlWord({ word }: { word: string }) {
  if (!hasArabic(word) || !/[^\s؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(word)) return <span>{word}</span>;
  const pieces = word.split(ARABIC_RUN).filter(Boolean);
  return <span style={{ display: "flex", flexDirection: "row-reverse" }}>{pieces.map((p, i) => <span key={i}>{p}</span>)}</span>;
}

function Pill({ children, bg, color, rtl }: { children: ReactNode; bg: string; color: string; rtl?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: rtl ? "row-reverse" : "row", alignItems: "center", gap: 10, background: bg, color, borderRadius: 999, padding: "10px 22px" }}>
      {children}
    </div>
  );
}

function Tick() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24">
      <polyline points="5 13 10 18 19 7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* The card's frame. Two explicit footer slots (not a fragment): Satori's flex
   spacing only sees direct children. The ochre rule is the last flex child, edge to
   edge — no absolute offsets, so nothing in here has a left or a right. */
function Frame({ rtl, logo, children, footerStart, footerEnd }: {
  rtl: boolean; logo: string | null; children: ReactNode; footerStart: ReactNode; footerEnd?: ReactNode;
}) {
  const row = rtl ? "row-reverse" : "row";
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: P.cream, fontFamily: "Jakarta" }}>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 72px 52px" }}>
        <div style={{ display: "flex", flexDirection: row, alignItems: "center", gap: 18 }}>
          {/* Satori renders <img>, not next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo && <img src={logo} width={64} height={64} alt="" />}
          <Line text="Tnajem" size={36} family="Grotesk" color={P.ink} />
          <Line text="تنجّم" size={32} family="Plex" color={P.blue} rtl />
        </div>
        {children}
        <div style={{ display: "flex", flexDirection: row, alignItems: "center", justifyContent: "space-between", gap: 24 }}>
          <div style={{ display: "flex" }}>{footerStart}</div>
          {footerEnd ? <div style={{ display: "flex" }}>{footerEnd}</div> : null}
        </div>
      </div>
      <div style={{ height: 12, background: P.ochre, display: "flex" }} />
    </div>
  );
}

const COPY = {
  fr: {
    verified: "Vérifié",
    from: (p: number) => `À partir de ${p} TND la séance`,
    live: "Cours en direct",
    with: (n: string) => `avec ${n}`,
    price: (p: number) => (p > 0 ? `${p} TND la séance` : "Séance gratuite"),
    at: "à",
  },
  ar: {
    verified: "متثبّت منّو",
    from: (p: number) => `ابتداءً من ${p} د.ت للحصة`,
    live: "دروس دايركت",
    with: (n: string) => `مع ${n}`,
    price: (p: number) => (p > 0 ? `${p} د.ت للحصة` : "حصة فابور"),
    at: "على",
  },
} as const;

export type TutorCardInput = {
  locale: "fr" | "ar";
  name: string;
  subject: string;
  initials: string;
  verified: boolean;
  /** An APPROVED photo as a data URI, or null for the monogram. */
  photo: string | null;
  /** Cheapest bookable class, or null when nothing is scheduled. */
  fromPrice: number | null;
  /** "tnajem.com/yassine-math" — shown, not linked. */
  displayUrl: string;
};

export async function tutorCard(input: TutorCardInput): Promise<ImageResponse> {
  const rtl = input.locale === "ar";
  const c = COPY[input.locale];
  const row = rtl ? "row-reverse" : "row";
  const align = rtl ? "flex-end" : "flex-start";
  const logo = await logoUri();
  return new ImageResponse(
    (
      <Frame
        rtl={rtl}
        logo={logo}
        footerStart={
          <Pill bg={P.ochreTint} color={P.ochreInk} rtl={rtl}>
            <Line text={input.fromPrice != null ? c.from(input.fromPrice) : c.live} size={30} family="Jakarta" color={P.ochreInk} rtl={rtl} />
          </Pill>
        }
        footerEnd={<Line text={input.displayUrl} size={26} family="Jakarta" weight={500} color={P.muted} />}
      >
        <div style={{ display: "flex", flexDirection: row, alignItems: "center", gap: 44 }}>
          {input.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={input.photo} width={210} height={210} alt="" style={{ borderRadius: 999, border: `6px solid ${P.paper}`, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 210, height: 210, borderRadius: 999, background: P.blue, color: P.paper, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 84, fontFamily: "Grotesk" }}>
              {input.initials || "T"}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: align, gap: 18, maxWidth: 760 }}>
            <Line text={input.name} size={70} family="Grotesk" color={P.ink} />
            {input.verified && (
              <Pill bg={P.greenBtn} color={P.paper} rtl={rtl}>
                <Tick />
                <Line text={c.verified} size={28} family="Jakarta" color={P.paper} rtl={rtl} />
              </Pill>
            )}
            {input.subject && <Line text={input.subject} size={36} family="Jakarta" weight={500} color={P.ink2} />}
          </div>
        </div>
      </Frame>
    ),
    await options(),
  );
}

export type ClassCardInput = {
  locale: "fr" | "ar";
  title: string;
  tutorName: string;
  subject: string;
  verified: boolean;
  /** "12/10/2026" and "18:00", Africa/Tunis. */
  date: string;
  time: string;
  durationMin: number;
  priceTnd: number;
  displayUrl: string;
};

export async function classCard(input: ClassCardInput): Promise<ImageResponse> {
  const rtl = input.locale === "ar";
  const c = COPY[input.locale];
  const align = rtl ? "flex-end" : "flex-start";
  const logo = await logoUri();
  return new ImageResponse(
    (
      <Frame
        rtl={rtl}
        logo={logo}
        footerStart={
          <Pill bg={P.ochreTint} color={P.ochreInk} rtl={rtl}>
            <Line text={c.price(input.priceTnd)} size={30} family="Jakarta" color={P.ochreInk} rtl={rtl} />
          </Pill>
        }
        footerEnd={<Line text={input.displayUrl} size={26} family="Jakarta" weight={500} color={P.muted} />}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: align, gap: 20 }}>
          <Line text={`${input.date} · ${input.time} · ${input.durationMin} min`} size={32} family="Jakarta" color={P.blue} />
          <Line text={input.title} size={62} family="Grotesk" color={P.ink} />
          <div style={{ display: "flex", flexDirection: rtl ? "row-reverse" : "row", alignItems: "center", gap: 16 }}>
            <Line text={c.with(input.tutorName)} size={34} family="Jakarta" weight={500} color={P.ink2} rtl={rtl} />
            {input.verified && (
              <div style={{ width: 40, height: 40, borderRadius: 999, background: P.greenBtn, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Tick />
              </div>
            )}
          </div>
          {input.subject && <Line text={input.subject} size={30} family="Jakarta" weight={500} color={P.muted} />}
        </div>
      </Frame>
    ),
    await options(),
  );
}

/** The plain brand card, for a slug or class that is not public. */
export async function fallbackCard(locale: "fr" | "ar"): Promise<ImageResponse> {
  const rtl = locale === "ar";
  const logo = await logoUri();
  return new ImageResponse(
    (
      <Frame rtl={rtl} logo={logo} footerStart={<Line text="tnajem.com" size={26} family="Jakarta" weight={500} color={P.muted} />}>
        <Line text={COPY[locale].live} size={64} family="Grotesk" color={P.ink} rtl={rtl} />
      </Frame>
    ),
    await options(),
  );
}
