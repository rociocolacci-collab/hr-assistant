import { generateText } from 'ai';
import { client } from './slack-utils';
import { buildKnowledgeText } from './notion';
import { model } from './model';

function errMsg(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw.slice(0, 300);
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
