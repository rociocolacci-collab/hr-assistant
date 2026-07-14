import type { Block, KnownBlock } from '@slack/web-api';

export function actionButtonsBlock(): KnownBlock {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Make a request' },
        action_id: 'submit_hr_request',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Talk to HR' },
        action_id: 'escalate_to_hr',
      },
    ],
  };
}

export function answerBlocks(answer: string): (KnownBlock | Block)[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
    actionButtonsBlock(),
  ];
}

export const WELCOME_MESSAGE =
  'Hi! How can I help you today?\n_Just type your question here in the chat._';

export function welcomeBlocks(): (KnownBlock | Block)[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: WELCOME_MESSAGE } },
    actionButtonsBlock(),
  ];
}

const GREETING_REGEX =
  /^(hi+|hey+|heya|hiya|hello+|hola+|buenas|howdy|yo|sup|good\s+(morning|afternoon|evening|day)|morning|afternoon|evening|what'?s\s+up|:wave:|👋)[\s!.,;:?~👋🙂😊😄]*$/i;

export function isGreeting(text: string): boolean {
  return GREETING_REGEX.test(text.trim());
}

export const NOTION_ERROR_MESSAGE =
  'Tuve un problema conectándome a Notion 😕 Por favor intentá de nuevo en unos segundos o contactá a People & Culture directamente.';

export function formatSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>');
}
