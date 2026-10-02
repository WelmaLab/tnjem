/* « MES FICHES » — live-fixes-1 · B. Pure, client-safe, safe in the barrel.

   A FICHE, as the tutor sees it in Mes fiches, is one row that can stand on two
   tables:

     packs      what the tutor lists on their page: a title, a detail line, a price
                (0 = « Gratuit »). Nothing is bought on Tnajem: the price is the
                tutor's, settled outside the platform.
     materials  the file or the YouTube video itself, which only the tutor's
                enrolled students can open (the access decision is canRead() in
                apps/api/src/routes/materials.ts — never here).

   « Nouvelle fiche » (/dashboard/new-pack) uploads the file as a material, then
   creates the pack with packs.material_id pointing at it (0041), so the two are ONE
   fiche. A material with no pack is a library item: a corrigé or a video for the
   tutor's students, not listed on the page, so it has no price.

   mergeFiches() is the one place that pairs them, used by GET /fiches/mine. */

export type FicheVisibility = "public" | "students" | "private";

export type TutorFiche = {
  /** "pack:<id>" or "material:<id>" — stable across reloads, unique in the list. */
  key: string;
  /** Set when the fiche is listed on the tutor's page (it has a price). */
  packId: string | null;
  /** Set when the fiche has a file or a video. */
  materialId: string | null;
  title: string;
  /** The pack's detail line, or the library item's description. */
  detail: string | null;
  /** The tutor's price in TND; null for a library item (not listed, no price). */
  priceTnd: number | null;
  source: "file" | "youtube" | null;
  fileName: string | null;
  /** The SNIFFED type of the file, never the uploader's claim. */
  mime: string | null;
  sizeBytes: number | null;
  youtubeId: string | null;
  /** The class it is attached to, if any (« Élèves de cette séance »). */
  classId: string | null;
  /** Who may open the file or video; null when there is none. */
  visibility: FicheVisibility | null;
  createdAt: string;
};

/** A class the tutor can attach a fiche to (the « Séance liée » picker). */
export type FicheClassOption = { id: string; title: string; startsAt: string; cancelled: boolean };

export type MyFiches = {
  ok: true;
  fiches: TutorFiche[];
  classes: FicheClassOption[];
  /** The tutor's verification status: a pack shows on the page only once verified. */
  verified: boolean;
};

export type FichePackRow = {
  id: string;
  title: string;
  description: string | null;
  priceTnd: number;
  materialId: string | null;
  createdAt: string;
};

export type FicheMaterialRow = {
  id: string;
  kind: "file" | "youtube";
  visibility: FicheVisibility;
  title: string;
  description: string | null;
  classId: string | null;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  youtubeId: string | null;
  createdAt: string;
};

/** Pair each pack with its material; every unpaired live material is a library item.
    Newest first. A pack whose material was removed shows as a fiche with no file. */
export function mergeFiches(packs: readonly FichePackRow[], materials: readonly FicheMaterialRow[]): TutorFiche[] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const used = new Set<string>();
  const out: TutorFiche[] = [];

  for (const p of packs) {
    const m = p.materialId ? byId.get(p.materialId) : undefined;
    if (m) used.add(m.id);
    out.push({
      key: `pack:${p.id}`,
      packId: p.id,
      materialId: m?.id ?? null,
      title: p.title,
      detail: p.description?.trim() ? p.description : null,
      priceTnd: p.priceTnd,
      source: m?.kind ?? null,
      fileName: m?.fileName ?? null,
      mime: m?.mime ?? null,
      sizeBytes: m?.sizeBytes ?? null,
      youtubeId: m?.youtubeId ?? null,
      classId: m?.classId ?? null,
      visibility: m?.visibility ?? null,
      createdAt: p.createdAt,
    });
  }

  for (const m of materials) {
    if (used.has(m.id)) continue;
    out.push({
      key: `material:${m.id}`,
      packId: null,
      materialId: m.id,
      title: m.title,
      detail: m.description?.trim() ? m.description : null,
      priceTnd: null,
      source: m.kind,
      fileName: m.fileName,
      mime: m.mime,
      sizeBytes: m.sizeBytes,
      youtubeId: m.youtubeId,
      classId: m.classId,
      visibility: m.visibility,
      createdAt: m.createdAt,
    });
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
