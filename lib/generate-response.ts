import { generateText, type CoreMessage } from 'ai';
import { buildKnowledgeText } from './notion';
import { model } from './model';
import { formatSlackMrkdwn } from './slack-blocks';

const SYSTEM_PROMPT_PREFIX = `You are the People Assistant at dotCMS. Give short, direct answers — like a helpful colleague on Slack, not a manual.

CRITICAL RULES:
- Keep answers to 3–5 lines max. No walls of text.
- Answer the specific question asked. Don't dump everything you know about a topic.
- NEVER say "check the policy" or "I recommend reviewing" — just answer directly.
- If something is truly not covered, only then suggest contacting People & Culture.
- End with ONE short follow-up question offering to go deeper on a specific part (e.g. "Want the details on how to submit in Brex?" or "Need info on the timeline?").
- If the question is already very specific, skip the follow-up question.

HR KNOWLEDGE BASE:
`;

const SYSTEM_PROMPT_SUFFIX = `
Slack formatting rules:
- Use *bold* (single asterisk only), never **double asterisk**
- No # headers
- Bullet points with -
- Links as plain URLs`;

export async function generateResponse(messages: CoreMessage[]): Promise<string> {
  const knowledgeText = await buildKnowledgeText();

  if (!knowledgeText) {
    throw new Error('NOTION_EMPTY');
  }

  const { text } = await generateText({
    model,
    maxTokens: 300,
    system: `${SYSTEM_PROMPT_PREFIX}${knowledgeText}${SYSTEM_PROMPT_SUFFIX}`,
    messages,
  });

  return formatSlackMrkdwn(text || 'I encountered an error. Please contact HR directly.');
}
