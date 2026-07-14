import type { SlackEvent } from '@slack/web-api';
import { waitUntil } from '@vercel/functions';
import { handleNewAppMention } from '../lib/handle-app-mention';
import { handleDirectMessage } from '../lib/handle-messages';
import { getBotId, verifyRequest } from '../lib/slack-utils';

export async function POST(request: Request) {
  const rawBody = await request.text();
  const payload = JSON.parse(rawBody) as {
    type: 'url_verification' | 'event_callback';
    challenge?: string;
    event?: SlackEvent;
  };

  if (payload.type === 'url_verification') {
    return new Response(payload.challenge, { status: 200 });
  }

  try {
    await verifyRequest({ requestType: payload.type, request, rawBody });
    const botUserId = await getBotId();
    const event = payload.event;

    if (!event) {
      return new Response('Success!', { status: 200 });
    }

    if (event.type === 'app_mention') {
      waitUntil(
        handleNewAppMention(event, botUserId).catch((err) =>
          console.error('handleNewAppMention error:', err)
        )
      );
    }

    if (
      event.type === 'message' &&
      'channel_type' in event &&
      event.channel_type === 'im' &&
      !('subtype' in event && event.subtype) &&
      !('bot_id' in event && event.bot_id) &&
      !('bot_profile' in event && event.bot_profile)
    ) {
      waitUntil(
        handleDirectMessage(event, botUserId).catch((err) =>
          console.error('handleDirectMessage error:', err)
        )
      );
    }

    return new Response('Success!', { status: 200 });
  } catch (error) {
    console.error('Error handling Slack event:', error);
    return new Response('Invalid request', { status: 400 });
  }
}
