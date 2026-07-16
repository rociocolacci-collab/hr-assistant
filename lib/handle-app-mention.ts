import type { AppMentionEvent } from '@slack/web-api';
import { client, getThread, sendDebugEnv, sendWelcome } from './slack-utils';
import { generateResponse } from './generate-response';
import { logInteraction } from './notion';
import { answerBlocks, isGreeting, NOTION_ERROR_MESSAGE } from './slack-blocks';

async function createStatusUpdater(event: AppMentionEvent) {
  const initialMessage = await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: 'Thinking...',
  });

  if (!initialMessage?.ts) {
    throw new Error('Failed to post initial message');
  }

  return async (text: string, blocks?: ReturnType<typeof answerBlocks>) => {
    await client.chat.update({
      channel: event.channel,
      ts: initialMessage.ts as string,
      text,
      blocks,
    });
  };
}

export async function handleNewAppMention(event: AppMentionEvent, botUserId: string) {
  if (event.bot_id || event.bot_id === botUserId || event.bot_profile) {
    return;
  }

  const question = event.text.replace(/<@[^>]+>/g, '').trim();
  if (!question) return;

  const threadForReply = event.thread_ts ?? event.ts;

  if (isGreeting(question)) {
    await sendWelcome(event.channel, threadForReply);
    return;
  }

  if (question.toLowerCase() === 'debug env') {
    await sendDebugEnv(event.channel, threadForReply);
    return;
  }

  console.log('Processing question:', question);

  const updateMessage = await createStatusUpdater(event);
  const threadTs = event.thread_ts ?? event.ts;

  try {
    const messages = event.thread_ts
      ? await getThread(event.channel, threadTs, botUserId)
      : [{ role: 'user' as const, content: question }];

    const answer = await generateResponse(messages);

    try {
      await updateMessage(answer, answerBlocks(answer));
    } catch (updateError) {
      console.error('Block update failed, falling back to plain text:', updateError);
      await updateMessage(answer);
    }

    await logInteraction({
      userId: event.user ?? 'unknown',
      question,
      response: answer,
      type: 'question',
      foundAnswer: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message === 'NOTION_EMPTY') {
      await updateMessage(NOTION_ERROR_MESSAGE);
      return;
    }

    console.error('Error handling app mention:', error instanceof Error ? error.stack ?? error : error);
    await updateMessage(
      'Tuve un problema procesando tu pregunta. Por favor intentá de nuevo o contactá a People & Culture.'
    );
  }
}
