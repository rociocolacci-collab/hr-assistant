import { generateText, type CoreMessage } from 'ai';
import { client, getThread } from './slack-utils';
import { buildKnowledgeText } from './notion';
import { model } from './model';
import { generateResponse } from './generate-response';

function errMsg(err: unknown): string {
  const anyErr = err as { statusCode?: number; responseBody?: unknown; cause?: unknown };
  let raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (anyErr?.statusCode) raw += ` [status ${anyErr.statusCode}]`;
  if (anyErr?.responseBody) raw += ` body: ${String(anyErr.responseBody).slice(0, 200)}`;
  if (anyErr?.cause) raw += ` cause: ${String(anyErr.cause).slice(0, 150)}`;
  return raw.slice(0, 500);
}

// "debug test" — exercises each dependency separately and reports the exact
// failure, so problems can be diagnosed from Slack without Vercel log access.
export async function sendDebugTest(channel: string, threadTs: string): Promise<void> {
  const lines: string[] = [];

  try {
    const r = await client.conversations.replies({ channel, ts: threadTs, limit: 3 });
    lines.push(`1. Slack thread read: ✅ (${r.messages?.length ?? 0} messages)`);
  } catch (err) {
    lines.push(`1. Slack thread read: ❌ ${errMsg(err)}`);
  }

  try {
    const start = Date.now();
    const text = await buildKnowledgeText();
    const secs = Math.round((Date.now() - start) / 100) / 10;
    lines.push(`2. Notion knowledge: ✅ (${text.length} chars in ${secs}s)`);
  } catch (err) {
    lines.push(`2. Notion knowledge: ❌ ${errMsg(err)}`);
  }

  try {
    const { text } = await generateText({ model, maxTokens: 20, prompt: 'Reply with just: ok' });
    lines.push(`3. Claude API: ✅ ("${text.trim().slice(0, 30)}")`);
  } catch (err) {
    lines.push(`3. Claude API: ❌ ${errMsg(err)}`);
  }

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `🧪 *Self-test*\n${lines.join('\n')}`,
  });
}

// "debug full" — runs the exact same pipeline as a real question
// (thread context + knowledge + system prompt + Claude) and reports
// the raw error of whichever part fails.
export async function sendDebugFull(
  channel: string,
  threadTs: string,
  botUserId: string
): Promise<void> {
  const lines: string[] = [];
  let messages: CoreMessage[] = [];

  try {
    messages = await getThread(channel, threadTs, botUserId);
    const roles = messages.map((m) => m.role).join(' → ');
    lines.push(`1. getThread: ✅ (${messages.length} messages: ${roles})`);
  } catch (err) {
    lines.push(`1. getThread: ❌ ${errMsg(err)}`);
  }

  try {
    const start = Date.now();
    const input: CoreMessage[] = messages.length
      ? messages
      : [{ role: 'user', content: 'What is the PTO policy?' }];
    const answer = await generateResponse(input);
    const secs = Math.round((Date.now() - start) / 100) / 10;
    lines.push(`2. generateResponse: ✅ (${answer.length} chars in ${secs}s)\n> ${answer.slice(0, 150)}`);
  } catch (err) {
    lines.push(`2. generateResponse: ❌ ${errMsg(err)}`);
  }

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `🧪 *Full pipeline test*\n${lines.join('\n')}`,
  });
}
