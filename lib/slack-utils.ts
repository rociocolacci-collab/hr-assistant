import { WebClient } from '@slack/web-api';
import type { CoreMessage } from 'ai';
import crypto from 'crypto';
import { WELCOME_MESSAGE, welcomeBlocks } from './slack-blocks';

const signingSecret = process.env.SLACK_SIGNING_SECRET;

export const client = new WebClient(process.env.SLACK_TOKEN);

export async function sendWelcome(channel: string, threadTs?: string): Promise<void> {
  await client.chat.postMessage({
    channel,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    text: WELCOME_MESSAGE,
    blocks: welcomeBlocks(),
  });
}

// Diagnostics: reports which env vars are set (never their values) and the running build
export async function sendDebugEnv(channel: string, threadTs?: string): Promise<void> {
  const flags = [
    'SLACK_HR_CHANNEL',
    'SLACK_SOFI_ID',
    'SLACK_ROCIO_ID',
    'SLACK_TOKEN',
    'NOTION_TOKEN',
    'CLAUDE_API_KEY',
  ]
    .map((k) => `${k}: ${process.env[k] ? '✅ set' : '❌ missing'}`)
    .join('\n');
  const build = process.env.VERCEL_GIT_COMMIT_SHA
    ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
    : 'unknown';
  await client.chat.postMessage({
    channel,
    ...(threadTs ? { thread_ts: threadTs } : {}),
    text: `🔍 *Deployed build:* ${build}\n${flags}`,
  });
}

export async function isValidSlackRequest({
  request,
  rawBody,
}: {
  request: Request;
  rawBody: string;
}): Promise<boolean> {
  if (!signingSecret) {
    console.error('SLACK_SIGNING_SECRET is not configured');
    return false;
  }

  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const slackSignature = request.headers.get('X-Slack-Signature');

  if (!timestamp || !slackSignature) {
    return false;
  }

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  const computedSignature = `v0=${hmac}`;

  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(slackSignature)
  );
}

export async function verifyRequest({
  requestType,
  request,
  rawBody,
}: {
  requestType: string;
  request: Request;
  rawBody: string;
}): Promise<void> {
  const validRequest = await isValidSlackRequest({ request, rawBody });
  if (!validRequest || requestType !== 'event_callback') {
    throw new Error('Invalid Slack request');
  }
}

export async function verifyInteractionRequest({
  request,
  rawBody,
}: {
  request: Request;
  rawBody: string;
}): Promise<void> {
  const validRequest = await isValidSlackRequest({ request, rawBody });
  if (!validRequest) {
    throw new Error('Invalid Slack request');
  }
}

export async function getThread(
  channelId: string,
  threadTs: string,
  botUserId: string
): Promise<CoreMessage[]> {
  const { messages } = await client.conversations.replies({
    channel: channelId,
    ts: threadTs,
    limit: 50,
  });

  if (!messages) {
    throw new Error('No messages found in thread');
  }

  return messages
    .map((message) => {
      const isBot = !!message.bot_id;
      if (!message.text) return null;

      let content = message.text;
      if (!isBot && content.includes(`<@${botUserId}>`)) {
        content = content.replace(new RegExp(`<@${botUserId}>\\s*`, 'g'), '').trim();
      }

      if (isBot && /^(Thinking\.\.\.|Tuve un problema)/i.test(content.trim())) {
        return null;
      }

      return {
        role: isBot ? 'assistant' : 'user',
        content,
      } as CoreMessage;
    })
    .filter((msg): msg is CoreMessage => msg !== null);
}

export async function getBotId(): Promise<string> {
  const { user_id: botUserId } = await client.auth.test();

  if (!botUserId) {
    throw new Error('botUserId is undefined');
  }

  return botUserId;
}
