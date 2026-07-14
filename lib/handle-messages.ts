import type { GenericMessageEvent } from '@slack/web-api';
import { client, getThread } from './slack-utils';
import { generateResponse } from './generate-response';
import { logInteraction } from './notion';
import { answerBlocks, NOTION_ERROR_MESSAGE } from './slack-blocks';

export async function handleDirectMessage(event: GenericMessageEvent, botUserId: string) {
  if (
    event.bot_id ||
    event.bot_id === botUserId ||
    event.bot_profile ||
    event.subtype
  ) {
    return;
  }

  const question = event.text?.replace(/<@[^>]+>/g, '').trim();
  if (!question) return;

  console.log('Processing DM:', question);

  const threadTs = event.thread_ts ?? event.ts;
  const { channel } = event;

  const initialMessage = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: 'Thinking...',
  });

  if (!initialMessage?.ts) {
    throw new Error('Failed to post initial DM message');
  }

  const updateMessage = async (text: string, blocks?: ReturnType<typeof answerBlocks>) => {
    await client.chat.update({
      channel,
      ts: initialMessage.ts as string,
      text,
      blocks,
    });
  };

  try {
    const messages = await getThread(channel, threadTs, botUserId);
    const answer = await generateResponse(messages);

    await updateMessage(answer, answerBlocks(answer));

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

    console.error('Error handling DM:', error);
    await updateMessage(
      'Tuve un problema procesando tu pregunta. Por favor intentá de nuevo o contactá a People & Culture.'
    );
  }
}
