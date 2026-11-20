/* VULN-004 — the deploy pipeline must not hand the production SSH key to mutable
   third-party code, and must pin the server's host key.

     node --test tools/security/workflows.test.mjs

   Text checks only (no YAML dependency): every `uses:` is a local path or a full
   40-hex commit SHA; deploy.yml checks the host key strictly against a
   known_hosts written from secrets.SERVER_KNOWN_HOSTS; SERVER_SSH_KEY appears in
   exactly one step, as a step-level env; the key file is removed by an
   `if: always()` cleanup; no appleboy action is left. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(repo, ".github", "workflows", f), "utf8").replace(/\r\n/g, "\n");
const workflows = { "ci.yml": read("ci.yml"), "deploy.yml": read("deploy.yml") };
const deploy = workflows["deploy.yml"];

/** Lines with their comment stripped (a `#` that starts a YAML comment). */
const code = (text) => text.split("\n").map((l) => l.replace(/(^|\s)#.*$/, ""));

/** The deploy job's steps, each as { name, text }. Split on the steps' own "- " indent. */
function deploySteps() {
  const lines = deploy.split("\n");
  const jobAt = lines.findIndex((l) => /^ {2}deploy:\s*$/.test(l));
  assert.ok(jobAt >= 0, "deploy.yml has no `deploy:` job");
  const stepsAt = lines.findIndex((l, i) => i > jobAt && /^ {4}steps:\s*$/.test(l));
  assert.ok(stepsAt >= 0, "deploy job has no steps");
  const steps = [];
  for (let i = stepsAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^ {0,4}\S/.test(l)) break; // left the steps list
    if (/^ {6}- /.test(l)) steps.push([]);
    if (steps.length) steps[steps.length - 1].push(l);
  }
  return steps.map((s) => {
    const text = s.join("\n");
    return { name: (text.match(/name:\s*(.+)/) ?? [])[1]?.trim() ?? "(unnamed)", text };
  });
}

for (const [file, text] of Object.entries(workflows)) {
  test(`${file}: every \`uses:\` is a local path or a full commit SHA`, () => {
    const bad = [];
    for (const line of code(text)) {
      const m = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
      if (!m) continue;
      const ref = m[1].replace(/^["']|["']$/g, "");
      if (ref.startsWith("./")) continue;
      if (!/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/.test(ref)) bad.push(ref);
    }
    assert.deepEqual(bad, [], `${file} uses mutable refs: ${bad.join(", ")}`);
  });

  test(`${file}: no host-key checking is ever disabled`, () => {
    assert.doesNotMatch(text, /StrictHostKeyChecking\s*=?\s*(no|accept-new|off)/i);
  });
}

test("deploy.yml: no appleboy action is left", () => {
  assert.doesNotMatch(deploy, /appleboy\//);
});

test("deploy.yml: ssh/scp check the host key strictly against SERVER_KNOWN_HOSTS", () => {
  assert.match(deploy, /StrictHostKeyChecking=yes/);
  assert.match(deploy, /UserKnownHostsFile=/);
  assert.match(deploy, /\$\{\{\s*secrets\.SERVER_KNOWN_HOSTS\s*\}\}/);
  const writer = deploySteps().filter((s) => /secrets\.SERVER_KNOWN_HOSTS/.test(s.text));
  assert.equal(writer.length, 1, "SERVER_KNOWN_HOSTS should feed exactly one step");
  assert.match(writer[0].text, /known_hosts/, "that step must write a known_hosts file");
});

test("deploy.yml: SERVER_SSH_KEY reaches exactly one step, as a step-level env", () => {
  const steps = deploySteps();
  const withKey = steps.filter((s) => /SERVER_SSH_KEY/.test(s.text));
  assert.equal(withKey.length, 1, `steps holding the key: ${withKey.map((s) => s.name).join(" | ")}`);
  const outside = deploy.split("\n").filter((l) => /SERVER_SSH_KEY/.test(l)).length;
  const inside = withKey[0].text.split("\n").filter((l) => /SERVER_SSH_KEY/.test(l)).length;
  assert.equal(outside, inside, "SERVER_SSH_KEY appears outside the deploy step (job/workflow env, comments, another step)");
  assert.match(withKey[0].text, /\n {8}env:\n(?: {10}.*\n)*? {10}\w+:\s*\$\{\{\s*secrets\.SERVER_SSH_KEY\s*\}\}/,
    "the key must be passed through the step's own env:, not `with:` or the script text");
  assert.doesNotMatch(withKey[0].text, /\n {8}with:/, "the key step must not hand it to an action");
});

test("deploy.yml: the key file is 0600 and removed by an if: always() cleanup", () => {
  const steps = deploySteps();
  const keyStep = steps.find((s) => /SERVER_SSH_KEY/.test(s.text));
  assert.ok(keyStep, "no step holds the key");
  assert.match(keyStep.text, /umask 077|chmod 600|install -m 600/);
  const cleanup = steps.find((s) => /if:\s*always\(\)/.test(s.text) && /rm -f/.test(s.text));
  assert.ok(cleanup, "no `if: always()` cleanup step removing the key file");
  assert.ok(steps.indexOf(cleanup) > steps.indexOf(keyStep), "the cleanup must run after the key step");
  assert.doesNotMatch(cleanup.text, /secrets\./, "the cleanup step needs no secret");
});
