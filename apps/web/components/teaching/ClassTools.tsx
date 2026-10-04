"use client";
import { useLocale } from "@/components/LocaleProvider";
import { Video, Board, Quiz } from "@/components/icons";
import type { ClassItem } from "@tnajem/shared";
import { isDefaultRoom } from "@tnajem/shared/live"; // live-fixes-3 · B4

/* Link-out teaching toolkit for a class: one-tap launchers for the tutor's
   video room (Jitsi/Meet), whiteboard (Bitpaper/Excalidraw) and quiz (Wooclap/Quizizz).
   Opens each in a new tab. Hidden tools simply don't render.

   live-fixes-3 · B4: no video tile for the DEFAULT (token) room — the lobby's
   « Entrer dans la classe » opens that very room, titled and with the viewer's name
   (B2); two buttons for one room was the bug. A tutor's own video link keeps its tile. */
export function ClassTools({ cls, dark }: { cls: ClassItem; dark?: boolean }) {
  const { t } = useLocale();
  const items = [
    cls.meet_url && !isDefaultRoom(cls.meet_url) && { Icon: Video, label: t.tools.join, href: cls.meet_url, color: "var(--green)" },
    cls.whiteboard_url && { Icon: Board, label: t.tools.whiteboard, href: cls.whiteboard_url, color: "var(--blue)" },
    cls.quiz_url && { Icon: Quiz, label: t.tools.quiz, href: cls.quiz_url, color: "var(--ochre)" },
  ].filter(Boolean) as { Icon: (p: { className?: string }) => React.JSX.Element; label: string; href: string; color: string }[];

  if (!items.length) return null;
  const tileBg = dark ? "rgba(255,255,255,.08)" : "var(--paper)";
  const tileBorder = dark ? "1px solid rgba(255,255,255,.14)" : "1px solid var(--line)";
  const labelColor = dark ? "var(--on-blue)" : "var(--ink)";

  return (
    <div style={{ margin: "6px 0" }}>
      <div className="sec" style={{ color: dark ? "#fff" : "var(--ink)", marginInline: 2 }}>{t.tools.section}</div>
      {/* auto-fit, not repeat(N,1fr): three tiles across a 320px screen leave ~89px
          each, which crushes "Tableau blanc" / "لوحة بيضاء" into a deformed column.
          They wrap to two rows instead. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(96px,1fr))", gap: 10 }}>
        {items.map(({ Icon, label, href, color }) => (
          <button
            key={label}
            type="button"
            onClick={() => window.open(href, "_blank", "noopener,noreferrer")}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 8, padding: "14px 8px", minHeight: 96, minWidth: 0,
              borderRadius: 16, background: tileBg, border: tileBorder, cursor: "pointer", color: labelColor,
            }}
          >
            <span
              style={{
                width: 40, height: 40, flex: "none", borderRadius: 12, display: "grid",
                placeItems: "center", background: color, color: "#fff",
              }}
            >
              <Icon />
            </span>
            <span className="text-[13px] font-bold text-center leading-[1.2] [overflow-wrap:anywhere]">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
