import { TelegramBot, TelegramMessage } from './client';

export interface InitBotParams {
  token: string;
  polling?: boolean;
  onMessage: (msg: TelegramMessage) => void | Promise<void>;
  onPollingError?: (error: Error) => void;
}

let bot: TelegramBot | undefined;

export function initBot(params: InitBotParams): TelegramBot {
  const polling = params.polling ?? true;

  bot = new TelegramBot(params.token, { polling });

  bot.on('message', params.onMessage);

  bot.on('polling_error', (error) => {
    if (params.onPollingError) {
      params.onPollingError(error);
      return;
    }
    console.error('Telegram polling error:', error);
  });

  return bot;
}

export function getBot(): TelegramBot {
  if (!bot) {
    throw new Error('Bot not initialized. Call initBot() first.');
  }
  return bot;
}

export function resetBotForTests(): void {
  bot = undefined;
}
