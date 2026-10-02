"use server";
/* Server actions — live-fixes-1 · pages team. « Mes fiches »: the tutor's own list,
   and editing or removing one fiche.

   Thin proxies to apps/api through lib/api.ts, under its five rules: every rule is
   enforced by the API (this file decides nothing), the `revalidate` envelope the
   API returns is replayed by call() (packs render on the ISR-cached /[slug]), and
   nothing is retried. Demo mode (no API, dev only) degrades to empty answers. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import type { ActionResult } from "@tnajem/shared/contracts";
import type { MyFiches } from "@tnajem/shared";

/** The signed-in tutor's fiches (a pack and its file as one row), and their classes. */
export async function getMyFiches(): Promise<MyFiches | null> {
  if (demoFallback) return { ok: true, fiches: [], classes: [], verified: false };
  return call<MyFiches | null>("/fiches/mine", undefined, "GET");
}

/** A listed fiche: title, detail, price, and the class its file is attached to
    (null detaches; leave it out to keep it). */
export async function updatePack(input: {
  id: string; title: string; meta?: string | null; priceTnd: number; classId?: string | null;
}): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  const { id, ...body } = input;
  return call<ActionResult>(`/packs/${encodeURIComponent(id)}/update`, body);
}

/** The fiche leaves the tutor's page; its file is removed with it. */
export async function deletePack(input: { id: string }): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult>(`/packs/${encodeURIComponent(input.id)}/delete`, {});
}

/** A library item (a file or a video with no price): title, description, who may open it, class. */
export async function updateMaterial(input: {
  id: string; title: string; description?: string | null;
  visibility: "public" | "students" | "private"; classId?: string | null;
}): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  const { id, ...body } = input;
  return call<ActionResult>(`/materials/${encodeURIComponent(id)}/update`, body);
}
