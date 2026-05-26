/**
 * Lightweight Telegram Bot API Client
 *
 * Custom implementation using only native Node.js APIs.
 * No external dependencies required.
 */

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
  }>;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_markup?: InlineKeyboardMarkup;
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const POLL_INTERVAL_MS = 100;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const REQUEST_TIMEOUT_MS = 40_000;
const REQUEST_RETRIES = 2;

interface TelegramBotOptions {
  polling?: boolean;
  baseUrl?: string;
  requestTimeoutMs?: number;
  requestRetries?: number;
}

export class TelegramBot {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly requestRetries: number;
  private polling = false;
  private offset = 0;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private retryDelay = RETRY_BASE_MS;

  private messageHandlers: Array<(msg: TelegramMessage) => void | Promise<void>> = [];
  private pollingErrorHandlers: Array<(error: Error) => void> = [];

  constructor(token: string, options?: TelegramBotOptions) {
    const baseUrl = options?.baseUrl?.trim() || `https://api.telegram.org/bot${token}`;
    this.baseUrl = baseUrl;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.requestRetries = options?.requestRetries ?? REQUEST_RETRIES;

    if (options?.polling) {
      this.startPolling();
    }
  }

  private async apiRequest<T = any>(method: string, params?: any): Promise<T> {
    const url = `${this.baseUrl}/${method}`;

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.requestRetries; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: params ? JSON.stringify(params) : undefined,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

        const data = (await response.json()) as TelegramApiResponse<T>;

        if (!data.ok) {
          const apiError = new Error(`Telegram API error: ${data.description || 'Unknown error'}`);

          if (!this.isRetryableTelegramError(data.error_code) || attempt >= this.requestRetries) {
            throw apiError;
          }

          lastError = apiError;
          await this.waitBeforeRetry(attempt);
          continue;
        }

        return data.result as T;
      } catch (error) {
        if (attempt >= this.requestRetries || !this.isRetryableNetworkError(error)) {
          if (error instanceof Error) {
            throw new Error(`Failed to call ${method}: ${error.message}`);
          }
          throw error;
        }

        lastError = error;
        await this.waitBeforeRetry(attempt);
      }
    }

    if (lastError instanceof Error) {
      throw new Error(`Failed to call ${method}: ${lastError.message}`);
    }

    throw new Error(`Failed to call ${method}: unknown error`);
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    const updates = await this.apiRequest<TelegramUpdate[]>('getUpdates', {
      offset: this.offset,
      timeout: 30,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
    });

    return updates || [];
  }

  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.polling) return;

    try {
      const updates = await this.getUpdates();

      for (const update of updates) {
        this.offset = update.update_id + 1;

        if (update.message) {
          for (const handler of this.messageHandlers) {
            try {
              await handler(update.message);
            } catch (error) {
              console.error('Error in message handler:', error);
            }
          }
        }

        if (update.edited_message) {
          for (const handler of this.messageHandlers) {
            try {
              await handler(update.edited_message);
            } catch (error) {
              console.error('Error in message handler:', error);
            }
          }
        }
      }
      this.retryDelay = RETRY_BASE_MS;
    } catch (error) {
      console.error('Polling error:', error);
      this.pollingErrorHandlers.forEach((handler) => {
        handler(error instanceof Error ? error : new Error(String(error)));
      });

      if (this.polling) {
        this.pollingTimeout = setTimeout(() => this.poll(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
      }
      return;
    }

    if (this.polling) {
      this.pollingTimeout = setTimeout(() => this.poll(), POLL_INTERVAL_MS);
    }
  }

  public stopPolling(): void {
    this.polling = false;
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  public on(event: 'message', handler: (msg: TelegramMessage) => void | Promise<void>): void;
  public on(event: 'polling_error', handler: (error: Error) => void): void;
  public on(event: string, handler: any): void {
    if (event === 'message') {
      this.messageHandlers.push(handler);
    } else if (event === 'polling_error') {
      this.pollingErrorHandlers.push(handler);
    }
  }

  public async sendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<TelegramMessage> {
    return this.apiRequest<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  public async sendChatAction(
    chatId: number,
    action:
      | 'typing'
      | 'upload_photo'
      | 'record_video'
      | 'upload_video'
      | 'record_voice'
      | 'upload_voice'
      | 'upload_document'
      | 'find_location'
      | 'record_video_note'
      | 'upload_video_note'
  ): Promise<boolean> {
    return this.apiRequest<boolean>('sendChatAction', {
      chat_id: chatId,
      action,
    });
  }

  public async getMe(): Promise<TelegramUser> {
    return this.apiRequest<TelegramUser>('getMe');
  }

  public async answerCallbackQuery(
    callbackQueryId: string,
    options?: {
      text?: string;
      show_alert?: boolean;
      url?: string;
    }
  ): Promise<boolean> {
    return this.apiRequest<boolean>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options,
    });
  }

  public async editMessageText(
    text: string,
    options?: {
      chat_id?: number;
      message_id?: number;
      inline_message_id?: string;
      parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
      reply_markup?: InlineKeyboardMarkup;
    }
  ): Promise<TelegramMessage | boolean> {
    return this.apiRequest<TelegramMessage | boolean>('editMessageText', {
      text,
      ...options,
    });
  }

  private async waitBeforeRetry(attempt: number): Promise<void> {
    const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private isRetryableTelegramError(errorCode?: number): boolean {
    if (!errorCode) {
      return false;
    }

    return errorCode === 429 || errorCode >= 500;
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const msg = error.message.toLowerCase();

    return (
      msg.includes('fetch failed') ||
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('eai_again') ||
      msg.includes('enotfound')
    );
  }
}
