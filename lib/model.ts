import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

const anthropic = createAnthropic({
  apiKey: process.env.CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY,
});

export const model: LanguageModel = anthropic('claude-sonnet-4-6');
