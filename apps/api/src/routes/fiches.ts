import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, isNull, sql as raw, classes, materials, packs, tutors } from "@tnajem/db";
import {
  isUuid, mergeFiches, vOptionalText, vPrice, vText, vUuid,
  type FicheClassOption, type MyFiches,
} from "@tnajem/shared";
import { db } from "../db";
import { getSession, type Session } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { assertNoContactInfo, CONTACT_ERROR } from "../lib/contact-guard";

/* « MES FICHES » — live-fixes-1 · B. The tutor's own list, and editing or removing
   one fiche (a pack, its file or video, or a library item: packages/shared/src/fiches.ts).

     GET  /fiches/mine                the list, merged, + the classes a fiche can be attached to
     POST /packs/:id/update           title, detail, price (+ the attached class of its file)
     POST /packs/:id/delete           the fiche leaves the page; its file is removed with it
     POST /materials/:id/update       a library item: title, description, who may open it, class

   Creating stays where it was (POST /packs, POST /materials). Every rule is here, the
   page only reflects it: the tutor's role and OWNERSHIP of the row on every call
   (another tutor's id answers not-found, never forbidden — no probing), the same
   validators and the same contact-info rule as on creation, and a write rate limit.
   No verification gate on editing or removing: a tutor can always tidy up — and the
   contact rule still guards every word that reaches a page. */

const MAX_FICHES = 200;

const packPatch = z.object({
  title: z.string(),
  meta: z.string().nullable().optional(),
  priceTnd: z.number(),
  /** The class the fiche's FILE is attached to; null detaches; absent = unchanged. */
  classId: z.string().nullable().optional(),
});

const materialPatch = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  visibility: z.enum(["public", "students", "private"]),
  classId: z.string().nullable().optional(),
});

type Tutor = { id: string; slug: string; status: string };

async function myTutor(session: Session | null): Promise<{ ok: true; tutor: Tutor } | { ok: false; error: string }> {
  if (!session) return { ok: false, error: "not-authenticated" };
  if (session.profile.role !== "tutor") return { ok: false, error: "not-a-tutor" };
  const [t] = await db
    .select({ id: tutors.id, slug: tutors.slug, status: tutors.status })
    .from(tutors)
    .where(eq(tutors.profileId, session.profile.id))
    .limit(1);
  return t ? { ok: true, tutor: { id: t.id, slug: t.slug, status: t.status ?? "draft" } } : { ok: false, error: "no-storefront" };
}

/** A class id from the body → the tutor's OWN class id, null (detach), or an error. */
async function ownClass(tutorId: string, raw: string | null | undefined): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (raw === null || raw === undefined || !raw.trim()) return { ok: true, id: null };
  const parsed = vUuid(raw, { field: "class" });
  if (!parsed.ok) return { ok: false };
  const [k] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, parsed.value), eq(classes.tutorId, tutorId)))
    .limit(1);
  return k ? { ok: true, id: k.id } : { ok: false };
}

export async function ficheRoutes(app: FastifyInstance): Promise<void> {
  /* ── GET /fiches/mine ─────────────────────────────────────────────────────── */
  app.get("/fiches/mine", async (req): Promise<MyFiches | null> => {
    const me = await myTutor(await getSession(req));
    if (!me.ok) return null;
    const tutorId = me.tutor.id;

    const [packRows, materialRows, classRows] = await Promise.all([
      db.select().from(packs).where(eq(packs.tutorId, tutorId)).orderBy(desc(packs.createdAt)).limit(MAX_FICHES),
      db.select().from(materials)
        .where(and(eq(materials.tutorId, tutorId), isNull(materials.removedAt)))
        .orderBy(desc(materials.createdAt))
        .limit(MAX_FICHES),
      // Cancelled ones too, flagged: a fiche can still name one; the picker leaves them out.
      db.select({ id: classes.id, title: classes.title, scheduledAt: classes.scheduledAt, status: classes.status })
        .from(classes)
        .where(eq(classes.tutorId, tutorId))
        .orderBy(desc(classes.scheduledAt))
        .limit(MAX_FICHES),
    ]);

    const fiches = mergeFiches(
      packRows.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        priceTnd: Number(p.priceTnd),
        materialId: p.materialId,
        createdAt: new Date(p.createdAt).toISOString(),
      })),
      materialRows.map((m) => ({
        id: m.id,
        kind: m.kind,
        visibility: m.visibility,
        title: m.title,
        description: m.description,
        classId: m.classId,
        fileName: m.fileName,
        mime: m.mime,
        sizeBytes: m.sizeBytes,
        youtubeId: m.youtubeId,
        createdAt: new Date(m.createdAt).toISOString(),
      })),
    );
    const classOptions: FicheClassOption[] = classRows.map((k) => ({
      id: k.id,
      title: k.title,
      startsAt: new Date(k.scheduledAt).toISOString(),
      cancelled: k.status === "cancelled",
    }));
    return { ok: true, fiches, classes: classOptions, verified: me.tutor.status === "verified" };
  });

  /* ── POST /packs/:id/update ───────────────────────────────────────────────── */
  app.post<{ Params: { id: string } }>("/packs/:id/update", async (req, reply) => {
    const parsed = packPatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    // The same three validators as POST /packs.
    const title = vText(input.title, { field: "title", max: 120, min: 3 });
    if (!title.ok) return { ok: false, error: title.error };
    const meta = vOptionalText(input.meta ?? null, { field: "meta", max: 200 });
    if (!meta.ok) return { ok: false, error: meta.error };
    const price = vPrice(input.priceTnd, { field: "price", max: 5000 });
    if (!price.ok) return { ok: false, error: price.error };

    const session = await getSession(req);
    const me = await myTutor(session);
    if (!me.ok) return { ok: false, error: me.error };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const [pack] = await db
      .select({ id: packs.id, materialId: packs.materialId })
      .from(packs)
      .where(and(eq(packs.id, req.params.id), eq(packs.tutorId, me.tutor.id)))
      .limit(1);
    if (!pack) return { ok: false, error: "not-found" };

    const klass = input.classId === undefined ? null : await ownClass(me.tutor.id, input.classId);
    if (klass && !klass.ok) return { ok: false, error: "not-found" };

    const rl = await checkRateLimit(`fiche:write:${me.tutor.id}`, 120, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    if (
      !(await assertNoContactInfo(session!.profile.id, [
        { surface: "pack_title", value: title.value },
        { surface: "pack_title", value: meta.value },
      ]))
    ) {
      return { ok: false, error: CONTACT_ERROR };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(packs)
        .set({ title: title.value, description: meta.value, priceTnd: String(price.value) })
        .where(eq(packs.id, pack.id));
      /* The file is the same fiche: it keeps the fiche's title (an enrolled student
         sees it under that name), and takes the class when one was chosen. */
      if (pack.materialId) {
        await tx
          .update(materials)
          .set({ title: title.value, ...(klass?.ok ? { classId: klass.id } : {}) })
          .where(and(eq(materials.id, pack.materialId), eq(materials.tutorId, me.tutor.id)));
      }
    });

    return { ok: true, revalidate: { tutors: [me.tutor.slug] } }; // packs render publicly
  });

  /* ── POST /packs/:id/delete ───────────────────────────────────────────────── */
  app.post<{ Params: { id: string } }>("/packs/:id/delete", async (req) => {
    const me = await myTutor(await getSession(req));
    if (!me.ok) return { ok: false, error: me.error };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const [pack] = await db
      .select({ id: packs.id, materialId: packs.materialId })
      .from(packs)
      .where(and(eq(packs.id, req.params.id), eq(packs.tutorId, me.tutor.id)))
      .limit(1);
    if (!pack) return { ok: false, error: "not-found" };

    await db.transaction(async (tx) => {
      /* Its file goes with it — soft, exactly like « Retirer » on a library item
         (POST /materials/:id/delete): the row records that it existed and when it
         went, so an open takedown claim against it keeps its record. */
      if (pack.materialId) {
        await tx
          .update(materials)
          .set({ removedAt: raw`now()`, removedReason: "removed-by-tutor" })
          .where(and(eq(materials.id, pack.materialId), eq(materials.tutorId, me.tutor.id), isNull(materials.removedAt)));
      }
      // A pack is a listing, not a record: payments.pack_id is ON DELETE SET NULL.
      await tx.delete(packs).where(eq(packs.id, pack.id));
    });

    return { ok: true, revalidate: { tutors: [me.tutor.slug] } };
  });

  /* ── POST /materials/:id/update ───────────────────────────────────────────── */
  app.post<{ Params: { id: string } }>("/materials/:id/update", async (req, reply) => {
    const parsed = materialPatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    // The same validators as POST /materials.
    const title = vText(input.title, { field: "title", max: 120, min: 3 });
    if (!title.ok) return { ok: false, error: title.error };
    const description = vOptionalText(input.description ?? null, { field: "description", max: 1000 });
    if (!description.ok) return { ok: false, error: description.error };

    const session = await getSession(req);
    const me = await myTutor(session);
    if (!me.ok) return { ok: false, error: me.error };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const [m] = await db
      .select({ id: materials.id })
      .from(materials)
      .where(and(eq(materials.id, req.params.id), eq(materials.tutorId, me.tutor.id), isNull(materials.removedAt)))
      .limit(1);
    if (!m) return { ok: false, error: "not-found" };

    const klass = input.classId === undefined ? null : await ownClass(me.tutor.id, input.classId);
    if (klass && !klass.ok) return { ok: false, error: "not-found" };

    const rl = await checkRateLimit(`fiche:write:${me.tutor.id}`, 120, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    if (
      !(await assertNoContactInfo(session!.profile.id, [
        { surface: "class_title", value: title.value },
        { surface: "class_description", value: description.value },
      ]))
    ) {
      return { ok: false, error: CONTACT_ERROR };
    }

    await db
      .update(materials)
      .set({
        title: title.value,
        description: description.value,
        visibility: input.visibility,
        ...(klass?.ok ? { classId: klass.id } : {}),
      })
      .where(eq(materials.id, m.id));

    return { ok: true, revalidate: { tutors: [me.tutor.slug] } };
  });
}
