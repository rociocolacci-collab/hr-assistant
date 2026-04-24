const { WebClient } = require('@slack/web-api');

const slack = new WebClient(process.env.SLACK_TOKEN);

const handler = async (req, res) => {
  const body = req.body;

  console.log('Received Slack event:', JSON.stringify(body));

  if (body?.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }

  res.status(200).send();

  const event = body?.event;
  if (!event) return;
  if (event.bot_id || event.bot_profile) return;

  if (event.type === 'app_mention') {
    console.log('app_mention received from:', event.user, 'in channel:', event.channel);
    await slack.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: 'Hola! Soy el People Assistant. Estoy funcionando correctamente.',
    });
  }
};

module.exports = handler;
