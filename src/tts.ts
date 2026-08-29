/**
 * Speech: text sanitising plus a non-blocking FIFO queue over the OS engine.
 *
 * Two rules shape everything here. A TTS failure must never take down the
 * server, because the lesson is the product and the narration is a bonus. And
 * lines must not overlap, which means strictly serial playback even though the
 * queue is filled from async tool handlers.
 *
 * On Windows the original implementation spawned a fresh PowerShell and ran
 * `Add-Type -AssemblyName System.Speech` per utterance, which is roughly a
 * second of process and JIT startup before a word is spoken. Here one
 * PowerShell is kept alive and fed utterances over stdin, so only the first
 * line pays that cost.
 */

import { exec as execCb, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const exec = promisify(execCb);
const log = (...a: unknown[]) => console.error("[miyagi]", ...a);

/** Strip markdown, code fences, symbols and URLs so the TTS engine reads prose. */
export function sanitizeForSpeech(raw: string): string {
  let t = raw;
  t = t.replace(/```[\s\S]*?```/g, " code block. ");
  t = t.replace(/`([^`]*)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " image. ");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/\bhttps?:\/\/\S+/gi, " link ");
  t = t.replace(/\bwww\.\S+/gi, " link ");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/^\s*[-*_]{3,}\s*$/gm, " ");
  t = t.replace(/\|/g, " ");
  t = t.replace(/(\*\*|__|\*|_|~~)/g, "");
  t = t.replace(/[#`<>{}\[\]\\^|]/g, " ");
  // Emoji / pictographs
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu,
    " "
  );
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 1200);
}

/** Quote a string for safe single-argument shell use. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface VoiceConfig {
  enabled: boolean;
  words_per_minute: number;
}

/* ------------------------------------------------------------------ *
 * Windows: one long-lived PowerShell
 * ------------------------------------------------------------------ */

/**
 * Utterances are delimited by a sentinel written to stdout after `Speak`
 * returns, which is how the queue knows a line finished without polling. If
 * the sentinel never arrives the child is killed and the caller falls back to
 * a one-shot process, so a wedged host does not silence the tutor forever.
 */
class WindowsSpeaker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private seq = 0;
  private pending: { marker: string; resolve: () => void; reject: (e: Error) => void } | null = null;
  private broken = false;

  private ensure(): ChildProcessWithoutNullStreams | null {
    if (this.broken) return null;
    if (this.child && !this.child.killed) return this.child;
    try {
      const child = spawn(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
        { stdio: ["pipe", "pipe", "pipe"] },
      ) as ChildProcessWithoutNullStreams;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => this.onData(chunk));
      child.stderr.on("data", () => {});
      child.on("error", () => this.fail(new Error("powershell failed to start")));
      child.on("exit", () => {
        this.child = null;
        this.fail(new Error("powershell exited"));
      });
      // The synthesizer is created once; every later utterance just sets Rate and speaks.
      child.stdin.write(
        "Add-Type -AssemblyName System.Speech; " +
          "$global:miyagi = New-Object System.Speech.Synthesis.SpeechSynthesizer;\n",
      );
      // A pending utterance must never hold the process open at shutdown.
      child.unref();
      child.stdin.on("error", () => this.fail(new Error("powershell stdin closed")));
      this.child = child;
      return child;
    } catch {
      this.broken = true;
      return null;
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (this.pending && this.buffer.includes(this.pending.marker)) {
      const done = this.pending;
      this.pending = null;
      this.buffer = "";
      done.resolve();
    }
    // Bound the buffer: a chatty host must not grow memory between markers.
    if (this.buffer.length > 8192) this.buffer = this.buffer.slice(-1024);
  }

  private fail(err: Error): void {
    const p = this.pending;
    this.pending = null;
    p?.reject(err);
  }

  async speak(text: string, wpm: number): Promise<boolean> {
    const child = this.ensure();
    if (!child) return false;

    // PowerShell rate is -10..10; 180 wpm is roughly rate 0.
    const rate = Math.max(-10, Math.min(10, Math.round((wpm - 180) / 20)));
    const marker = `<<miyagi:${++this.seq}>>`;
    const literal = text.replace(/'/g, "''");

    try {
      await new Promise<void>((resolve, reject) => {
        this.pending = { marker, resolve, reject };
        // A generous ceiling: long text at 80 wpm is genuinely slow.
        const timer = setTimeout(() => {
          if (this.pending?.marker === marker) {
            this.pending = null;
            this.child?.kill();
            this.child = null;
            reject(new Error("powershell speech timed out"));
          }
        }, 120_000);
        timer.unref?.();
        const ok = child.stdin.write(
          `$global:miyagi.Rate = ${rate}; $global:miyagi.Speak('${literal}'); Write-Output '${marker}'\n`,
        );
        if (!ok) {
          // Backpressure is fine; the drain will happen before the marker.
        }
      });
      return true;
    } catch (err) {
      log("persistent powershell speech failed, falling back:", (err as Error).message);
      return false;
    }
  }

  dispose(): void {
    this.broken = true;
    try {
      this.child?.stdin.end();
      this.child?.kill();
    } catch {
      // Shutting down; nothing left to salvage.
    }
    this.child = null;
  }
}

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

export class AudioQueue {
  private queue: string[] = [];
  private draining = false;
  private linuxSpeaker: string | null | undefined = undefined; // undefined = not probed
  private windows = new WindowsSpeaker();

  constructor(private readonly voice: VoiceConfig) {}

  enqueue(text: string): void {
    if (!this.voice.enabled) return;
    const clean = sanitizeForSpeech(text);
    if (!clean) return;
    this.queue.push(clean);
    if (!this.draining) void this.drain();
  }

  clear(): void {
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }

  dispose(): void {
    this.clear();
    this.windows.dispose();
  }

  /** Which engine this platform will use, for the config tool's report. */
  engineName(): string {
    const platform = os.platform();
    if (platform === "darwin") return "`say`";
    if (platform === "win32") return "PowerShell `System.Speech.Synthesis` (one long-lived process)";
    return this.linuxSpeaker
      ? `\`${this.linuxSpeaker}\``
      : "`spd-say` (falls back to espeak-ng/espeak/festival)";
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        try {
          await this.speak(next);
        } catch (err) {
          // Never let a TTS failure take down the server.
          log("tts failed (non-fatal):", (err as Error).message);
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) void this.drain();
    }
  }

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      await exec(`command -v ${cmd}`, { shell: "/bin/sh" });
      return true;
    } catch {
      return false;
    }
  }

  private async resolveLinuxSpeaker(): Promise<string | null> {
    if (this.linuxSpeaker !== undefined) return this.linuxSpeaker;
    for (const cmd of ["spd-say", "espeak-ng", "espeak", "festival"]) {
      if (await this.commandExists(cmd)) {
        this.linuxSpeaker = cmd;
        return cmd;
      }
    }
    this.linuxSpeaker = null;
    log("no Linux TTS binary found; audio disabled for this session");
    return null;
  }

  private async speak(text: string): Promise<void> {
    const platform = os.platform();
    const wpm = Math.min(400, Math.max(80, Math.round(this.voice.words_per_minute)));
    const timeout = 120_000;

    if (platform === "darwin") {
      if (!(await this.commandExists("say"))) return;
      await exec(`say -r ${wpm} -- ${shellQuote(text)}`, { timeout });
      return;
    }

    if (platform === "win32") {
      if (await this.windows.speak(text, wpm)) return;
      // Fallback: the one-shot path, so speech survives a broken host process.
      const rate = Math.max(-10, Math.min(10, Math.round((wpm - 180) / 20)));
      const script =
        `Add-Type -AssemblyName System.Speech; ` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$s.Rate = ${rate}; ` +
        `$s.Speak('${text.replace(/'/g, "''")}');`;
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      await exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { timeout });
      return;
    }

    // Linux / other POSIX
    const speaker = await this.resolveLinuxSpeaker();
    if (!speaker) return;
    const quoted = shellQuote(text);
    if (speaker === "spd-say") {
      // spd-say rate is -100..100; 180 wpm ~= 0.
      const rate = Math.max(-100, Math.min(100, Math.round((wpm - 180) / 2)));
      await exec(`spd-say -w -r ${rate} -- ${quoted}`, { timeout });
    } else if (speaker === "festival") {
      await exec(`echo ${quoted} | festival --tts`, { timeout, shell: "/bin/sh" });
    } else {
      await exec(`${speaker} -s ${wpm} ${quoted}`, { timeout });
    }
  }
}
