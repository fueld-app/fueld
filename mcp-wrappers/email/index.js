#!/usr/bin/env node
/**
 * Fueld Email MCP Server (project-scoped) — stdio JSON-RPC.
 *
 * Account: patrick@fueld.app on the self-hosted Stalwart mail server
 * (mail.fueld.app — SMTP 465 implicit TLS, IMAPS 993).
 *
 * Credentials: macOS Keychain, service `pi-mcp-fueld-email` (account `pi`).
 *   security add-generic-password -a pi -s pi-mcp-fueld-email -w '<mail password>'
 *
 * Tools:
 *   send_email          — send from patrick@fueld.app (text and/or html, cc, bcc, reply-to headers)
 *   list_recent_emails  — last N messages from a mailbox (default INBOX), envelopes only
 *   read_email          — full plain-text body of one message by uid
 *
 * Project-scoped: loaded only in fueld sessions via fueld/.pi/mcp.json.
 * Pattern follows raiden-energy/mcp-wrappers (Keychain secrets, never on disk).
 */

import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { execSync } from "child_process";

const MAIL_HOST = "mail.fueld.app";
const MAIL_USER = "patrick@fueld.app";

function getKeychainSecret(service) {
  try {
    return execSync(`security find-generic-password -a pi -s ${service} -w 2>/dev/null`, {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

const mailPassword = getKeychainSecret("pi-mcp-fueld-email");
if (!mailPassword) {
  process.stderr.write(
    "FATAL: fueld mail password not found in Keychain.\n" +
    "Store it once with:\n" +
    "  security add-generic-password -a pi -s pi-mcp-fueld-email -w '<mail password>'\n",
  );
  // Keep the process alive but tool-less? Pi expects the server to speak MCP;
  // exiting signals a broken server. Exit so the failure is visible immediately.
  process.exit(1);
}

const smtpTransport = nodemailer.createTransport({
  host: MAIL_HOST,
  port: 465,
  secure: true, // implicit TLS (Stalwart)
  auth: { user: MAIL_USER, pass: mailPassword },
});

// ── tools ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "send_email",
    description:
      "Send an email from patrick@fueld.app via the fueld.app mail server. " +
      "Use for real correspondence (customers, partners, suppliers).",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient address (or comma-separated list)" },
        cc: { type: "string", description: "Optional CC (comma-separated)" },
        bcc: { type: "string", description: "Optional BCC (comma-separated)" },
        subject: { type: "string" },
        body: { type: "string", description: "Plain-text body" },
        html: { type: "string", description: "Optional HTML body (overrides plain text in rich clients)" },
        inReplyTo: { type: "string", description: "Optional Message-ID being replied to (sets In-Reply-To/References threading)" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "list_recent_emails",
    description:
      "List the most recent emails in a mailbox (default INBOX) with uid, from, subject and date. " +
      "Use to check for replies before following up.",
    inputSchema: {
      type: "object",
      properties: {
        mailbox: { type: "string", description: "Mailbox name, default INBOX" },
        limit: { type: "number", description: "How many, default 10, max 50" },
        unreadOnly: { type: "boolean", description: "Only unseen messages" },
      },
    },
  },
  {
    name: "read_email",
    description: "Read one email's full plain-text body by uid (from list_recent_emails).",
    inputSchema: {
      type: "object",
      properties: {
        uid: { type: "number" },
        mailbox: { type: "string", description: "Mailbox name, default INBOX" },
      },
      required: ["uid"],
    },
  },
];

// ── tool implementations ─────────────────────────────────────────────

async function sendEmail(args) {
  const { to, cc, bcc, subject, body, html, inReplyTo } = args;
  if (!to || !subject || body == null) throw new Error("to, subject and body are required");
  const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: 465,
    secure: true,
    auth: { user: MAIL_USER, pass: mailPassword },
  });
  const info = await transporter.sendMail({
    from: `"Patrick Pereira" <${MAIL_USER}>`,
    to,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    subject,
    text: body,
    ...(html ? { html } : {}),
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

async function withImap(fn) {
  const client = new ImapFlow({
    host: MAIL_HOST,
    port: 993,
    secure: true,
    auth: { user: MAIL_USER, pass: mailPassword },
    logger: false,
    emitLogs: false,
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}

async function listRecent(args) {
  const mailbox = args.mailbox || "INBOX";
  const limit = Math.min(Number(args.limit) || 15, 50);
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const status = await client.status(mailbox, { messages: true });
      const total = status.messages ?? 0;
      if (total === 0) return [];
      const messages = [];
      const fromSeq = Math.max(1, total - limit + 1);
      const msgs = [];
      for await (const m of client.fetch({ seq: `${fromSeq}:*` }, { uid: true, envelope: true, flags: true })) {
        msgs.push(m);
      }
      msgs.reverse(); // newest first
      for (const m of msgs) {
        if (args.unreadOnly && m.flags?.has("\\Seen")) continue;
        messages.push({
          uid: m.uid,
          seq: m.seq,
          from: m.envelope?.from?.map((a) => `${a.name ?? ""} <${a.address ?? ""}>`).join(", ") ?? null,
          subject: m.envelope?.subject ?? null,
          date: m.envelope?.date ?? null,
          seen: m.flags?.has("\\Seen") ?? false,
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  });
}

async function readEmail(args) {
  const mailbox = args.mailbox || "INBOX";
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const m = await client.fetchOne(Number(args.uid), { uid: true, envelope: true, bodyStructure: true, source: true }, { uid: true });
      if (!m) return { error: `uid ${args.uid} not found in ${mailbox}` };
      // extract text part crudely
      let text = null;
      if (m.bodyStructure?.childNodes) {
        const textNode = m.bodyStructure.childNodes.find(
          (c) => c.type === "text" && !c.disposition,
        );
        if (textNode) {
          const part = textNode.part || "1";
          const { content } = await client.download(String(m.uid), String(textNode.part ?? "1"), { uid: true });
          text = content ? content.toString("utf8") : null;
        }
      }
      if (text == null && m.bodyStructure?.type?.startsWith("text/")) {
        text = m.bodyStructure.disposition ? text : null;
      }
      return {
        uid: m.uid,
        from: m.envelope?.from?.map((a) => `${a.name ?? ""} <${a.address ?? ""}>`).join(", ") ?? null,
        to: m.envelope?.to?.map((a) => a.address ?? "").join(", ") ?? null,
        subject: m.envelope?.subject ?? null,
        date: m.envelope?.date ?? null,
        text: (text ?? m.source?.toString("utf8") ?? "").slice(0, 400000),
      };
    } finally {
      lock.release();
    }
  });
}

// ── MCP stdio plumbing (newline-delimited JSON-RPC) ──────────────────

const SERVER_INFO = { name: "fueld-email", version: "1.0.0" };

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handle(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    };
  }
  if (method === "tools/list") {
    return { tools: TOOLS };
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      let result;
      if (name === "send_email") result = await sendEmail(args);
      else if (name === "list_recent_emails") result = await listRecent(args);
      else if (name === "read_email") result = await readEmail(args);
      else throw new Error(`Unknown tool: ${name}`);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 1).slice(0, 40000) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err?.message ?? err}` }],
        isError: true,
      };
    }
  }
  return null;
}

let buffer = "";
let stdinEnded = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const { id, method, params } = msg;
    if (method === "notifications/initialized" || method?.startsWith("notifications/")) continue;
    if (method === "ping") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: {} }) + "\n");
      continue;
    }
    pending++;
    try {
      const result = await origHandle(method, params);
      if (result === null) {
        replyError(id, -32601, `Method not found: ${method}`);
      } else {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
      }
    } catch (err) {
      replyError(id, -32603, String(err?.message ?? err));
    } finally {
      pending--;
      if (pending === 0 && stdinEnded) setTimeout(() => process.exit(0), 250);
    }
  }
});
let pending = 0;
const origHandle = handle;
process.stderr.write(`[fueld-email-mcp] ready as ${MAIL_USER}\n`);