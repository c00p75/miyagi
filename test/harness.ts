/**
 * A minimal MCP client for the end-to-end suites.
 *
 * Real clients do things the unit tests cannot simulate: they answer the
 * server's elicitation prompts, they serve sampling requests, and they receive
 * notifications. Since those are now load-bearing — a destructive command is
 * gated on a human answering, and a grade can be changed by a model — the tests
 * have to be able to play that role, including playing it badly.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ENTRY = path.resolve(here, "..", "src", "miyagi.js");

export interface ElicitAnswer {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string>;
}

export interface ClientOptions {
  home: string;
  cwd?: string;
  /** Advertised capabilities. Omit one and the server must fall back gracefully. */
  capabilities?: { elicitation?: boolean; sampling?: boolean };
  /** How this client answers an elicitation. Default: accept with "RUN". */
  onElicit?: (message: string) => ElicitAnswer;
  /** What the model replies to a sampling request. Default: refuse to answer. */
  onSample?: (prompt: string) => string | null;
}

export class TestClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 0;
  private waiters = new Map<number, (msg: any) => void>();

  /** Everything the server asked us to do, for assertions about being asked. */
  readonly elicitations: string[] = [];
  readonly samplings: string[] = [];
  readonly notifications: Array<{ method: string; params: any }> = [];
  readonly stderr: string[] = [];

  constructor(private readonly options: ClientOptions) {
    this.child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: options.cwd,
      env: { ...process.env, MIYAGI_HOME: options.home },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.stderr.push(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch (err) {
        // Anything unparseable on stdout is a protocol violation, and the most
        // likely cause is a stray console.log, so surface it loudly.
        throw new Error(`non-JSON on stdout: ${line.slice(0, 200)}`);
      }
      if (msg.method && msg.id != null) {
        void this.handleServerRequest(msg);
      } else if (msg.method) {
        this.notifications.push({ method: msg.method, params: msg.params });
      } else if (msg.id != null) {
        const waiter = this.waiters.get(msg.id);
        if (waiter) {
          this.waiters.delete(msg.id);
          waiter(msg);
        }
      }
    }
  }

  /** Server-initiated requests: elicitation and sampling. */
  private async handleServerRequest(msg: any): Promise<void> {
    const reply = (result: unknown) =>
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
    const fail = (message: string) =>
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message } }) + "\n",
      );

    if (msg.method === "elicitation/create") {
      const message = String(msg.params?.message ?? "");
      this.elicitations.push(message);
      const answer = this.options.onElicit?.(message) ?? {
        action: "accept" as const,
        content: { confirm: "RUN" },
      };
      reply(answer);
      return;
    }

    if (msg.method === "sampling/createMessage") {
      const prompt = String(msg.params?.messages?.[0]?.content?.text ?? "");
      this.samplings.push(prompt);
      const text = this.options.onSample?.(prompt) ?? null;
      if (text === null) {
        fail("this client declines to sample");
        return;
      }
      reply({ role: "assistant", model: "test-model", content: { type: "text", text } });
      return;
    }

    fail(`unhandled server request: ${msg.method}`);
  }

  send(method: string, params?: unknown): Promise<any> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000);
      this.waiters.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    return this.send("tools/call", { name, arguments: args });
  }

  /** Tool text, which is what a human would actually read. */
  async text(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const res = await this.call(name, args);
    return res.result.content[0].text as string;
  }

  /** Tool structured output, which is what a client would act on. */
  async data(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const res = await this.call(name, args);
    return res.result.structuredContent;
  }

  async initialize(): Promise<any> {
    const capabilities: Record<string, unknown> = {};
    if (this.options.capabilities?.elicitation) capabilities.elicitation = {};
    if (this.options.capabilities?.sampling) capabilities.sampling = {};
    const init = await this.send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities,
      clientInfo: { name: "miyagi-test-client", version: "1" },
    });
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    return init;
  }

  close(): void {
    this.child.kill();
  }
}

/** A valid sampling reply for the grader, so tests can steer a verdict. */
export function graderReply(correct: boolean, reason = "Same idea, different words."): string {
  return `Here you go:\n\`\`\`json\n${JSON.stringify({ correct, reason })}\n\`\`\``;
}

/** A valid sampling reply for question generation. */
export function generatorReply(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    question: "When piping JSON through `jq`, what does `-e` change about the exit code?",
    choices: [
      "It exits non-zero when the last output was null or false",
      "It enables extended regular expressions",
      "It echoes the filter before running it",
      "It disables colour output",
    ],
    answer: "It exits non-zero when the last output was null or false",
    explanation:
      "`-e` makes jq's exit status reflect the output, which is what lets a shell branch on whether a value was present.",
    level: "Mid",
    ...over,
  });
}
