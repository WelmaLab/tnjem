import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, desc, eq, isNull, sql as raw,
  classes, materials, materialTakedowns, tutorStrikes, tutors,
  objectStore, storageKey, type StoredObject,
} from "@tnajem/db";
import {
  isUuid,
  isAdult,
  parseYouTubeId,
  safeFileName,
  vText,
  vOptionalText,
  vUuid,
  isValidEmail,
  normalizeEmail,
  type MaterialItem,
} from "@tnajem/shared";
import { db } from "../db";
import { getSession } from "../lib/session";
import { readUploadPart } from "../lib/uploads";
import { processAvatar, AVATAR_SIZES } from "../lib/avatar";
import { assertNoContactInfo, CONTACT_ERROR } from "../lib/contact-guard";
import { checkRateLimit, ipBucket } from "../lib/rate-limit";
import { requireAdmin } from "../lib/admin";
import { auditAdmin } from "../lib/audit";
import { canRead, canReadWith, materialAccessContext } from "../lib/material-access"; // student-space-v1 · pages (C6)

/* phase-a lane L4 (A11): delete the three stored sizes of ONE photo version.
   Best-effort: the row has already moved on, so a failure here leaves an orphan
   that account erasure still sweeps (it deletes all of avatars/<tutorId>/) — it is
   logged, never thrown into the tutor's request. */
async function deleteAvatarVersion(path: string, log: FastifyBaseLogger): Promise<void> {
  const store = objectStore();
  for (const size of AVATAR_SIZES) {
    try {
      await store.delete(`${path}-${size.name}.webp`);
    } catch (e) {
      log.warn({ code: (e as { code?: string }).code ?? (e as Error).name }, "a replaced photo could not be deleted from storage");
    }
  }
}

/* MATERIALS (Step 10) — worksheets, corrections and videos a tutor attaches.

   ══════════════════════════════════════════════════════════════════════════════
   THE ACCESS DECISION LIVES HERE, AND ONLY HERE.
   ══════════════════════════════════════════════════════════════════════════════
   Files are written under STORAGE_DIR, never public/, for one reason: a static
   directory cannot ask "did this student actually book the class?". Serving a
   `students` worksheet from public/ would make the visibility column a
   decoration — the file would be one guessed URL away from anyone.

     public    anyone, signed in or not
     students  the tutor, plus a student with a LIVE booking on one of their
               classes (not a cancelled one)
     private   the tutor alone

   `students` is the DEFAULT, not `public`. A tutor uploading a worksheet almost
   certainly means "for the people in my class", and the safe default is the one
   that cannot surprise them.

   ══════════════════════════════════════════════════════════════════════════════
   THE FILE ITSELF
   ══════════════════════════════════════════════════════════════════════════════
   Same pipeline as an identity document (lib/uploads.ts): the bytes are sniffed,
   truncation is checked because @fastify/multipart truncates rather than
   throwing, the SNIFFED type is what gets stored and later served, and the
   filename is sanitised before it reaches a Content-Disposition header.

   Videos store an 11-character id, never a URL — see parseYouTubeId. */

const MAX_MATERIAL_BYTES = 8 * 1024 * 1024;
/* Smaller than a worksheet on purpose: this is one face, re-encoded to at most
   320px. Anything larger is a camera original nobody needs us to keep. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const OK_AVATAR_MIME = /^image\/(png|jpeg|webp|heic)$/;
const MAX_MATERIALS_PER_TUTOR = 200;
/* A BYTE QUOTA THAT COUNTS REMOVED FILES. The count cap above only sees live rows,
   and deleting a material only marks it, so upload → delete → upload filled the
   disk or bucket without limit (security review, 15 Sept 2026). The quota is the
   most a tutor could ever keep live — 200 files at the 8 MB ceiling — so it takes
   nothing a tutor was promised; it only stops the loop. Removed files are not yet
   deleted from storage: their retention is a legal decision (Stage 5). */
const MAX_MATERIAL_STORED_BYTES = MAX_MATERIALS_PER_TUTOR * 8 * 1024 * 1024;

/* Deliberately narrower than the ID-document allow-list: no HEIC. A worksheet is
   a PDF or an image a browser can actually render, and HEIC is neither on most
   desktops. Nothing here executes in a browser — SVG is absent on purpose, being
   an XML document that can carry <script>. */
const OK_MATERIAL_MIME = /^(application\/pdf|image\/(png|jpeg|webp))$/;

const SAFE_SERVE_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/** The policy a material's bytes are served with (GET /materials/:id/file). */
export const MATERIAL_FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

/* WHO MAY READ A MATERIAL: canRead() moved to lib/material-access.ts (student-space-v1 ·
   pages, contract C6). It is the ONE rule, shared with « Mes fiches » and every student
   list, so a list and this file endpoint can never disagree. The rule is unchanged. */

function toItem(m: typeof materials.$inferSelect): MaterialItem {
  return {
    id: m.id,
    kind: m.kind,
    visibility: m.visibility,
    title: m.title,
    description: m.description ?? undefined,
    classId: m.classId ?? undefined,
    fileName: m.fileName ?? undefined,
    mime: m.mime ?? undefined,
    sizeBytes: m.sizeBytes ?? undefined,
    youtubeId: m.youtubeId ?? undefined,
    createdAt: new Date(m.createdAt).toISOString(),
  };
}

/* One read path for materials and photos. A row whose key could escape the store
   is a 404 before anything is opened: the value comes from our own database, so
   this is defence in depth, but the route returns whatever bytes it opens and one
   bad row must not become "read any file on the box". A store that errors (disk,
   permissions, a bucket outage) is a 503 and a log line, not a misleading 404. */
async function openStored(key: string, log: FastifyBaseLogger): Promise<StoredObject | null | "unavailable"> {
  try {
    storageKey(key, { legacy: true });
  } catch {
    return null;
  }
  try {
    return await objectStore().open(key);
  } catch (e) {
    log.error({ code: (e as { code?: string }).code ?? (e as Error).name }, "object store read failed");
    return "unavailable";
  }
}

export async function materialRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /materials — upload a file, or attach a video ──────────────────── */
  app.post("/materials", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const uid = session.profile.id;

    const [mine] = await db
      .select({ id: tutors.id, status: tutors.status })
      .from(tutors)
      .where(eq(tutors.profileId, uid))
      .limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };
    /* Same verification gate as createClass. A rejected tutor does not get to
       keep stocking a library that goes live the instant anyone flips a status. */
    if (mine.status !== "verified") return { ok: false, error: "not-verified" };

    const [{ n: existing } = { n: 0 }] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(materials)
      .where(and(eq(materials.tutorId, mine.id), isNull(materials.removedAt)));
    if (existing >= MAX_MATERIALS_PER_TUTOR) return { ok: false, error: "too-many-materials" };

    const rl = await checkRateLimit(`material:upload:${mine.id}`, 30, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    const [{ bytes: storedBytes } = { bytes: 0 }] = await db
      .select({ bytes: raw<number>`coalesce(sum(${materials.sizeBytes}), 0)::bigint` })
      .from(materials)
      .where(eq(materials.tutorId, mine.id));
    const quotaLeft = MAX_MATERIAL_STORED_BYTES - Number(storedBytes);
    if (quotaLeft <= 0) return { ok: false, error: "storage-quota-reached" };

    const fields = new Map<string, string>();
    let file: { fileName: string; bytes: Buffer; mime: string } | null = null;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file") {
          await part.toBuffer(); // drain, or the stream stalls
          continue;
        }
        const read = await readUploadPart(part, {
          maxBytes: MAX_MATERIAL_BYTES,
          allow: OK_MATERIAL_MIME,
        });
        if (!read.ok) {
          // "file-required" here means an empty part, which is just no file.
          if (read.error === "file-required") continue;
          return { ok: false, error: read.error };
        }
        file = read.value;
      } else {
        fields.set(part.fieldname, String(part.value ?? ""));
      }
    }

    const title = vText(fields.get("title"), { field: "title", max: 120, min: 3 });
    if (!title.ok) return { ok: false, error: title.error };
    const description = vOptionalText(fields.get("description"), { field: "description", max: 1000 });
    if (!description.ok) return { ok: false, error: description.error };

    const visibility = fields.get("visibility") ?? "students";
    if (!["public", "students", "private"].includes(visibility)) {
      return { ok: false, error: "invalid-visibility" };
    }

    /* Title and description are user-authored text on a page other people read,
       so Step 8's rule applies here exactly as it does to a class title. */
    if (
      !(await assertNoContactInfo(uid, [
        { surface: "class_title", value: title.value },
        { surface: "class_description", value: description.value },
      ]))
    ) {
      return { ok: false, error: CONTACT_ERROR };
    }

    /* An optional class to attach to, and it must be the TUTOR'S OWN class —
       otherwise a tutor could staple their material to somebody else's page. */
    let classId: string | null = null;
    const rawClassId = fields.get("classId");
    if (rawClassId && rawClassId.trim()) {
      const parsed = vUuid(rawClassId, { field: "class" });
      if (!parsed.ok) return { ok: false, error: "not-found" };
      const [cls] = await db
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.id, parsed.value), eq(classes.tutorId, mine.id)))
        .limit(1);
      if (!cls) return { ok: false, error: "not-found" };
      classId = cls.id;
    }

    const youtubeRaw = fields.get("youtubeUrl");
    const youtubeId = youtubeRaw ? parseYouTubeId(youtubeRaw) : null;

    if (file && youtubeId) return { ok: false, error: "one-source-only" };
    if (!file && !youtubeId) {
      // A pasted link that is not YouTube lands here, and the code says which.
      return { ok: false, error: youtubeRaw ? "invalid-youtube-url" : "file-required" };
    }

    if (youtubeId) {
      const [row] = await db
        .insert(materials)
        .values({
          tutorId: mine.id,
          classId,
          kind: "youtube",
          visibility: visibility as "public" | "students" | "private",
          title: title.value,
          description: description.value,
          youtubeId,
        })
        .returning({ id: materials.id });
      return { ok: true, id: row.id };
    }

    /* Persist. Key materials/<tutorId>/<file> in the object store, never public/.
       `mine.id` comes from the session's own tutor row, so a tutor can only write
       into their own folder. */
    if (file && file.bytes.length > quotaLeft) return { ok: false, error: "storage-quota-reached" };
    const safe = `${Date.now()}-${safeFileName(file!.fileName, 60)}`;
    const key = `materials/${mine.id}/${safe}`;
    await objectStore().put(key, file!.bytes);

    const [row] = await db
      .insert(materials)
      .values({
        tutorId: mine.id,
        classId,
        kind: "file",
        visibility: visibility as "public" | "students" | "private",
        title: title.value,
        description: description.value,
        // The object key itself: POSIX separators, always.
        storagePath: key,
        fileName: safeFileName(file!.fileName, 60),
        mime: file!.mime, // the SNIFFED type — never the client's claim
        sizeBytes: file!.bytes.length,
      })
      .returning({ id: materials.id });

    return { ok: true, id: row.id };
  });

  /* ── GET /materials/mine — the tutor's own library ───────────────────────── */
  app.get("/materials/mine", async (req): Promise<MaterialItem[] | null> => {
    const session = await getSession(req);
    if (!session) return null;
    const [mine] = await db
      .select({ id: tutors.id })
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine) return null;

    const rows = await db
      .select()
      .from(materials)
      .where(and(eq(materials.tutorId, mine.id), isNull(materials.removedAt)))
      .orderBy(desc(materials.createdAt))
      .limit(MAX_MATERIALS_PER_TUTOR);
    return rows.map(toItem);
  });

  /* ── GET /tutors/:slug/materials — what THIS viewer may see ──────────────── */
  app.get<{ Params: { slug: string } }>("/tutors/:slug/materials", async (req): Promise<MaterialItem[]> => {
    const [tutor] = await db
      .select({ id: tutors.id, status: tutors.status, suspendedAt: tutors.suspendedAt })
      .from(tutors)
      .where(eq(tutors.slug, req.params.slug))
      .limit(1);
    if (!tutor || tutor.status !== "verified" || tutor.suspendedAt) return []; // A blocked account's storefront is suspended (0019): off every public read.

    /* SESSION-DEPENDENT, so this endpoint is NOT part of the anonymous ISR set —
       it is fetched with cache:"no-store" by the storefront's client component,
       not during SSR. Mixing it into the cached storefront payload would serve
       one student's entitlements to everybody. See the header of routes/tutors.ts. */
    const session = await getSession(req);
    const uid = session?.profile.id ?? null;

    const rows = await db
      .select()
      .from(materials)
      .where(and(eq(materials.tutorId, tutor.id), isNull(materials.removedAt)))
      .orderBy(desc(materials.createdAt))
      .limit(MAX_MATERIALS_PER_TUTOR);

    // The ONE rule (lib/material-access.ts), the viewer's side read once for the whole list.
    const ctx = await materialAccessContext(uid, [tutor.id]);
    return rows.filter((m) => canReadWith(m, ctx)).map(toItem);
  });

  /* ── GET /materials/:id/file — the bytes ─────────────────────────────────── */
  app.get<{ Params: { id: string } }>("/materials/:id/file", async (req, reply) => {
    if (!isUuid(req.params.id)) return reply.code(404).send({ error: "not-found" });

    const [m] = await db.select().from(materials).where(eq(materials.id, req.params.id)).limit(1);
    /* A removed material is a 404, not a 403: an upheld copyright claim should
       make the file disappear, not advertise that it once existed. */
    if (!m || m.removedAt || m.kind !== "file" || !m.storagePath) {
      return reply.code(404).send({ error: "not-found" });
    }

    const session = await getSession(req);
    if (!(await canRead(m, session?.profile.id ?? null))) {
      return reply.code(403).send({ error: "forbidden" });
    }

    const stored = await openStored(m.storagePath, req.log);
    if (stored === "unavailable") return reply.code(503).send({ error: "unavailable" });
    if (!stored) return reply.code(404).send({ error: "not-found" });

    /* The SNIFFED type, and only from an allow-list. Serving a stored string
       straight into Content-Type is how a "PNG" gets run as HTML. */
    const mime = m.mime && SAFE_SERVE_MIME.has(m.mime) ? m.mime : "application/octet-stream";
    reply.header("content-type", mime);
    /* `private` even for public materials: a shared cache keyed only on the URL
       would hand a students-only file to the next person through it. */
    reply.header("cache-control", "private, no-store");
    reply.header("x-content-type-options", "nosniff");
    /* THE ONE API RESPONSE A BROWSER RENDERS AS A DOCUMENT (live-fixes-2 · D): a
       student opens the file in a tab, and the browser's own viewer shows it. So it
       keeps the API's baseline — default-src 'none', nothing may frame it — plus the
       one thing Chrome's image viewer needs: it lays out its page (centred image,
       dark backdrop) with inline style attributes, which default-src 'none' refuses,
       three console errors and the image pinned to a corner. An inline style cannot
       run code, and these bytes are never HTML (allow-listed type, nosniff). The web
       route passes this header through untouched (apps/web/next.config.mjs);
       e2e/lf2-d-material-csp.spec.ts pins it on both. */
    reply.header("content-security-policy", MATERIAL_FILE_CSP);
    reply.header(
      "content-disposition",
      `inline; filename="${safeFileName(m.fileName ?? "material", 60)}"`,
    );
    reply.header("content-length", stored.size);
    return reply.send(stored.stream);
  });

  /* ── POST /materials/:id/delete — the tutor removes their own ────────────── */
  app.post<{ Params: { id: string } }>("/materials/:id/delete", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const [m] = await db
      .select({ id: materials.id, tutorId: materials.tutorId })
      .from(materials)
      .where(eq(materials.id, req.params.id))
      .limit(1);
    if (!m) return { ok: false, error: "not-found" };

    const [mine] = await db
      .select({ id: tutors.id, slug: tutors.slug })
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine || mine.id !== m.tutorId) return { ok: false, error: "not-found" };

    /* Soft, like a takedown: the row records that it existed and when it went.
       A hard DELETE would also destroy any open takedown claim against it. */
    await db
      .update(materials)
      .set({ removedAt: raw`now()`, removedReason: "removed-by-tutor" })
      .where(eq(materials.id, m.id));

    return { ok: true, revalidate: { tutors: [mine.slug] } };
  });

  /* ══════════════════════════════════════════════════════════════════════════
     PROFILE PHOTOS (Step 13)
     ══════════════════════════════════════════════════════════════════════════

     THREE RULES, and each closes something specific:

       1. NOTHING IS PUBLISHED ON UPLOAD. Every photo lands `pending` and is
          visible only to its owner until a human approves it. There is no code
          path that writes `approved` from this endpoint. A face on a public page
          in a product used by children is not a "review it later" surface.

       2. THE ORIGINAL IS NEVER STORED. sharp re-encodes to three sizes and drops
          every metadata block, so the EXIF GPS tag a phone writes — the tutor's
          home coordinates, usually — never reaches disk. See lib/avatar.ts.

       3. A MINOR GETS A GENERATED AVATAR, NEVER A PHOTOGRAPH. Today this is
          belt-and-braces: becomeTutor already refuses a minor, so no minor can
          hold a tutor row. It is written here anyway because the guard that
          matters is the one at the write site — if students ever get photos, or
          if the age check is ever relaxed, this is the line that has to already
          exist rather than the one someone remembers to add. */
  app.post("/avatar", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };

    /* RULE 3, and it is checked FIRST — before the file is even read. A minor's
       photograph should not exist in this process's memory, let alone on disk,
       for the moments between reading it and refusing it. */
    // phase-a/integrate (A24): month-aware and fail-safe — a missing month is a minor.
    if (!isAdult(session.profile.birthYear, session.profile.birthMonth)) {
      return { ok: false, error: "minor-no-photo" };
    }

    const [mine] = await db
      .select({ id: tutors.id, slug: tutors.slug, status: tutors.status })
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };

    const rl = await checkRateLimit(`avatar:${session.profile.id}`, 10, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    let original: Buffer | null = null;
    for await (const part of req.parts()) {
      if (part.type !== "file") continue;
      if (part.fieldname !== "photo") {
        await part.toBuffer(); // drain, or the stream stalls
        continue;
      }
      const read = await readUploadPart(part, {
        maxBytes: MAX_AVATAR_BYTES,
        allow: OK_AVATAR_MIME,
      });
      if (!read.ok) {
        if (read.error === "file-required") continue;
        return { ok: false, error: read.error };
      }
      original = read.value.bytes;
    }
    if (!original) return { ok: false, error: "file-required" };

    const processed = await processAvatar(original);
    if (!processed.ok) return { ok: false, error: processed.error };

    const stamp = Date.now();
    const store = objectStore();
    for (const out of processed.value) {
      await store.put(`avatars/${mine.id}/${stamp}-${out.name}.webp`, out.bytes);
    }

    /* RULE 1. `pending`, always. If this ever reads anything else, the review
       step has been removed and photos publish themselves.
       phase-a lane L4 (A11): the previous version is read under the row lock, so
       two concurrent uploads each delete exactly the one they replaced. */
    const newPath = `avatars/${mine.id}/${stamp}`;
    const previous = await db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ avatarPath: tutors.avatarPath })
        .from(tutors)
        .where(eq(tutors.id, mine.id))
        .for("update");
      await tx
        .update(tutors)
        .set({
          avatarPath: newPath,
          avatarStatus: "pending",
          avatarUpdatedAt: raw`now()`,
        })
        .where(eq(tutors.id, mine.id));
      return cur?.avatarPath ?? null;
    });
    // phase-a lane L4 (A11): the replaced photo leaves storage — after the row moved on.
    if (previous && previous !== newPath) await deleteAvatarVersion(previous, req.log);

    /* The storefront is cached and shows the monogram until approval, so nothing
       changes there yet — but a REPLACEMENT photo un-approves the old one, and
       that must reach the cached page immediately. */
    return { ok: true, status: "pending", revalidate: { tutors: [mine.slug] } };
  });

  /* ── DELETE the photo (POST, to match every other mutation here) ─────────── */
  app.post("/avatar/delete", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };

    const [mine] = await db
      .select({ id: tutors.id, slug: tutors.slug })
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };

    /* The row is cleared FIRST: a failed unlink must not leave the database
       claiming a photo that is gone — the ordering that matters is "stop pointing
       at it first".
       phase-a lane L4 (A11): and THEN the files go. They used to be "left for the
       retention job", which never touched avatars, so a deleted photo stayed in
       storage for good. */
    const previous = await db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ avatarPath: tutors.avatarPath })
        .from(tutors)
        .where(eq(tutors.id, mine.id))
        .for("update");
      await tx
        .update(tutors)
        .set({ avatarPath: null, avatarStatus: null, avatarUpdatedAt: raw`now()` })
        .where(eq(tutors.id, mine.id));
      return cur?.avatarPath ?? null;
    });
    if (previous) await deleteAvatarVersion(previous, req.log);

    return { ok: true, revalidate: { tutors: [mine.slug], publicTutors: true } };
  });

  /* ── GET /tutors/:slug/avatar/:size — the bytes ──────────────────────────── */
  app.get<{ Params: { slug: string; size: string } }>(
    "/tutors/:slug/avatar/:size",
    async (req, reply) => {
      const size = AVATAR_SIZES.find((s) => s.name === req.params.size);
      if (!size) return reply.code(404).send({ error: "not-found" });

      const [t] = await db
        .select({
          id: tutors.id,
          profileId: tutors.profileId,
          status: tutors.status,
          avatarPath: tutors.avatarPath,
          avatarStatus: tutors.avatarStatus,
        })
        .from(tutors)
        .where(eq(tutors.slug, req.params.slug))
        .limit(1);
      if (!t || !t.avatarPath) return reply.code(404).send({ error: "not-found" });

      /* WHO MAY SEE IT.

         approved + the tutor is public  -> anyone. It is on their storefront.
         anything else                   -> the OWNER alone.

         A `pending` photo is not merely unpublished, it is unreviewed: it could
         be anything at all, and the one person entitled to see it before a human
         does is the person who uploaded it. */
      const isOwner = t.profileId != null && t.profileId === (await getSession(req))?.profile.id;
      const isPublic = t.avatarStatus === "approved" && t.status === "verified";
      if (!isPublic && !isOwner) return reply.code(404).send({ error: "not-found" });

      const stored = await openStored(`${t.avatarPath}-${size.name}.webp`, req.log);
      if (stored === "unavailable") return reply.code(503).send({ error: "unavailable" });
      if (!stored) return reply.code(404).send({ error: "not-found" });

      reply.header("content-type", "image/webp");
      reply.header("x-content-type-options", "nosniff");
      /* An APPROVED photo is public and immutable at this URL — the timestamp is
         part of avatarPath, so a replacement is a different URL. A pending one
         must never be cached anywhere: it can be revoked in the next minute. */
      reply.header(
        "cache-control",
        isPublic ? "public, max-age=86400, immutable" : "private, no-store",
      );
      reply.header("content-length", stored.size);
      return reply.send(stored.stream);
    },
  );

  /* ── GET /admin/avatars — the review queue ───────────────────────────────── */
  app.get("/admin/avatars", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return [];
    const rows = await db
      .select({
        tutorId: tutors.id,
        slug: tutors.slug,
        fullName: tutors.fullName,
        updatedAt: tutors.avatarUpdatedAt,
        avatarPath: tutors.avatarPath,
      })
      .from(tutors)
      .where(eq(tutors.avatarStatus, "pending"))
      .orderBy(desc(tutors.avatarUpdatedAt))
      .limit(200);
    return rows.map((r) => ({
      tutorId: r.tutorId,
      slug: r.slug,
      fullName: r.fullName,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      /* Which photo this row is about: the decision must name it back. */
      version: r.avatarPath ? r.avatarPath.split("/").pop() : null,
    }));
  });

  /* ── GET /admin/avatars/:tutorId/:size — a pending photo, for its reviewer ───
     The public photo route serves a pending photo to its owner only, so no admin
     could see the face they were asked to approve. no-store: it may be rejected
     in the next minute. */
  app.get<{ Params: { tutorId: string; size: string } }>("/admin/avatars/:tutorId/:size", async (req, reply) => {
    const session = await requireAdmin(req);
    if (!session) return reply.code(403).send({ error: "forbidden" });
    const size = AVATAR_SIZES.find((s) => s.name === req.params.size);
    if (!size || !isUuid(req.params.tutorId)) return reply.code(404).send({ error: "not-found" });
    const [t] = await db
      .select({ avatarPath: tutors.avatarPath })
      .from(tutors)
      .where(eq(tutors.id, req.params.tutorId))
      .limit(1);
    if (!t?.avatarPath) return reply.code(404).send({ error: "not-found" });
    const stored = await openStored(`${t.avatarPath}-${size.name}.webp`, req.log);
    if (stored === "unavailable") return reply.code(503).send({ error: "unavailable" });
    if (!stored) return reply.code(404).send({ error: "not-found" });
    reply.header("content-type", "image/webp");
    reply.header("x-content-type-options", "nosniff");
    reply.header("cache-control", "private, no-store");
    reply.header("content-length", stored.size);
    return reply.send(stored.stream);
  });

  /* ── POST /admin/avatars/:tutorId — approve or reject ────────────────────── */
  app.post<{ Params: { tutorId: string } }>("/admin/avatars/:tutorId", async (req, reply) => {
    const parsed = z.object({ approve: z.boolean(), version: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    if (!isUuid(req.params.tutorId)) return { ok: false, error: "not-found" };

    const [t] = await db
      .select({ id: tutors.id, slug: tutors.slug, avatarStatus: tutors.avatarStatus, avatarPath: tutors.avatarPath })
      .from(tutors)
      .where(eq(tutors.id, req.params.tutorId))
      .limit(1);
    if (!t || t.avatarStatus == null || !t.avatarPath) return { ok: false, error: "not-found" };

    /* THE PHOTO THAT WAS REVIEWED, AND ONLY A PENDING ONE. This approved whatever
       was current — a photo swapped in after the admin looked, or one rejected
       earlier (security review, 15 Sept 2026). The version and the status are
       conditions of the UPDATE itself. */
    const reviewedPath = `${t.avatarPath.slice(0, t.avatarPath.lastIndexOf("/") + 1)}${parsed.data.version}`;
    // Phase A+ (P3): the decision and its audit row commit together.
    const decided = await db.transaction(async (tx) => {
      const [d] = await tx
        .update(tutors)
        .set({ avatarStatus: parsed.data.approve ? "approved" : "rejected" })
        .where(and(eq(tutors.id, t.id), eq(tutors.avatarStatus, "pending"), eq(tutors.avatarPath, reviewedPath)))
        .returning({ id: tutors.id });
      if (d) await auditAdmin(session.profile.id, parsed.data.approve ? "avatar.approve" : "avatar.reject", { kind: "tutor", id: t.id }, null, tx);
      return d;
    });
    if (!decided) {
      return { ok: false, error: t.avatarStatus === "pending" ? "changed-since-review" : "not-pending" };
    }

    /* An approval changes a PUBLIC page and the catalogue, so both caches go. */
    return { ok: true, revalidate: { tutors: [t.slug], publicTutors: true } };
  });

  /* ── POST /materials/:id/takedown — a copyright claim, NO AUTH ───────────── */
  app.post<{ Params: { id: string } }>("/materials/:id/takedown", async (req, reply) => {
    const parsed = z
      .object({ claimantName: z.string(), claimantEmail: z.string(), reason: z.string() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    /* UNAUTHENTICATED ON PURPOSE. A rights-holder is almost never a user of this
       site, and making them sign up to complain is the same as having no process.
       That means the only throttle is per-IP, and it has to exist: an open write
       endpoint without one is a spam target. */
    const rl = await checkRateLimit(`takedown:${ipBucket(req.ip)}`, 5, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    const name = vText(parsed.data.claimantName, { field: "name", max: 120, min: 2 });
    if (!name.ok) return { ok: false, error: name.error };
    const reason = vText(parsed.data.reason, { field: "reason", max: 2000, min: 10 });
    if (!reason.ok) return { ok: false, error: reason.error };
    const email = normalizeEmail(parsed.data.claimantEmail ?? "");
    if (!isValidEmail(email)) return { ok: false, error: "invalid-email" };

    const [m] = await db
      .select({ id: materials.id, removedAt: materials.removedAt })
      .from(materials)
      .where(eq(materials.id, req.params.id))
      .limit(1);
    if (!m || m.removedAt) return { ok: false, error: "not-found" };

    await db.insert(materialTakedowns).values({
      materialId: m.id,
      claimantName: name.value,
      claimantEmail: email,
      reason: reason.value,
    });

    /* NOTHING IS REMOVED YET, and the response says so rather than implying a
       result. An unauthenticated endpoint that hides content on demand is a
       censorship button for anyone who finds the URL. A human decides. */
    return { ok: true, status: "received" };
  });

  /* ── GET /admin/takedowns — open copyright claims, oldest first ─────────── */
  app.get("/admin/takedowns", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return [];
    const rows = await db
      .select({
        id: materialTakedowns.id,
        claimantName: materialTakedowns.claimantName,
        claimantEmail: materialTakedowns.claimantEmail,
        reason: materialTakedowns.reason,
        createdAt: materialTakedowns.createdAt,
        materialId: materials.id,
        materialTitle: materials.title,
        tutorName: tutors.fullName,
        tutorSlug: tutors.slug,
      })
      .from(materialTakedowns)
      .innerJoin(materials, eq(materialTakedowns.materialId, materials.id))
      .innerJoin(tutors, eq(materials.tutorId, tutors.id))
      .where(eq(materialTakedowns.status, "open"))
      .orderBy(materialTakedowns.createdAt)
      .limit(200);
    return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
  });

  /* ── POST /admin/takedowns/:id/resolve ───────────────────────────────────── */
  app.post<{ Params: { id: string } }>("/admin/takedowns/:id/resolve", async (req, reply) => {
    const parsed = z.object({ uphold: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    /* requireAdmin is the ONE gate — the same function the verification queue and
       the ID-scan stream use. A second, hand-rolled admin check here is exactly
       how the allow-list ended up tested in one place and running in another. */
    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };
    if (!isUuid(req.params.id)) return { ok: false, error: "not-found" };

    const [claim] = await db
      .select()
      .from(materialTakedowns)
      .where(eq(materialTakedowns.id, req.params.id))
      .limit(1);
    if (!claim) return { ok: false, error: "not-found" };
    if (claim.status !== "open") return { ok: true, already: true }; // idempotent

    const [m] = await db
      .select({ id: materials.id, tutorId: materials.tutorId })
      .from(materials)
      .where(eq(materials.id, claim.materialId))
      .limit(1);

    await db.transaction(async (tx) => {
      await tx
        .update(materialTakedowns)
        .set({
          status: parsed.data.uphold ? "upheld" : "rejected",
          resolvedAt: raw`now()`,
          resolvedBy: session.profile.id,
        })
        .where(eq(materialTakedowns.id, claim.id));
      // Phase A+ (P3): the decision's audit row commits with it.
      await auditAdmin(session.profile.id, parsed.data.uphold ? "takedown.upheld" : "takedown.rejected", { kind: "material", id: claim.materialId }, null, tx);

      if (!m) return;
      if (!parsed.data.uphold) return;

      await tx
        .update(materials)
        .set({ removedAt: raw`now()`, removedReason: "copyright-takedown" })
        .where(eq(materials.id, m.id));

      /* ONE STRIKE PER UPHELD CLAIM, and unique(takedown_id) is what makes that
         true: a moderator refreshing the queue must not double a tutor's count.
         Counted, never auto-enforced — a threshold that suspends an account on
         its own takes a livelihood away with no human in the loop. */
      await tx
        .insert(tutorStrikes)
        .values({ tutorId: m.tutorId, takedownId: claim.id, reason: "copyright-takedown" })
        .onConflictDoNothing();
    });

    return { ok: true };
  });
}
