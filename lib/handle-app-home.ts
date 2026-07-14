import type { AppHomeOpenedEvent } from '@slack/web-api';
import { client, sendWelcome } from './slack-utils';

// Fires when the user opens the bot's chat — greet only if the conversation is empty
export async function handleAppHomeOpened(event: AppHomeOpenedEvent): Promise<void> {
  if (event.tab && event.tab !== 'messages') return;
  if (!event.channel) return;

  const history = await client.conversations.history({
    channel: event.channel,
    limit: 1,
  });

  if (!history.messages || history.messages.length === 0) {
    await sendWelcome(event.channel);
  }
}
