import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramBot } from '../src/client';

const TOKEN = 'test-token-123';
const API_BASE = `https://api.telegram.org/bot${TOKEN}`;

const mockUser = {
  id: 42,
  is_bot: true,
  first_name: 'TestBot',
  username: 'testbot',
};

const mockMessage = {
  message_id: 1,
  chat: { id: 100, type: 'private' as const },
  date: 1_000_000,
  text: 'hello',
};

function apiOk<T>(result: T) {
  return { json: () => Promise.resolve({ ok: true, result }) };
}

function apiError(description: string, error_code?: number) {
  return { json: () => Promise.resolve({ ok: false, description, error_code }) };
}

/** Flush the microtask queue deeply enough to resolve chained awaits. */
async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('TelegramBot', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('does not start polling by default', () => {
      new TelegramBot(TOKEN);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('starts polling immediately when polling: true', async () => {
      fetchMock.mockResolvedValue(apiOk([]));
      const bot = new TelegramBot(TOKEN, { polling: true });
      await flushPromises();
      expect(fetchMock).toHaveBeenCalled();
      bot.stopPolling();
    });

    it('uses a custom baseUrl', async () => {
      fetchMock.mockResolvedValueOnce(apiOk(mockUser));
      const bot = new TelegramBot(TOKEN, { baseUrl: 'https://custom/bot' });
      await bot.getMe();
      expect(fetchMock).toHaveBeenCalledWith('https://custom/bot/getMe', expect.any(Object));
    });
  });

  // ─── API methods ──────────────────────────────────────────────────────────

  describe('getMe()', () => {
    it('returns bot info and calls the correct endpoint', async () => {
      fetchMock.mockResolvedValueOnce(apiOk(mockUser));
      const bot = new TelegramBot(TOKEN);
      const result = await bot.getMe();
      expect(result).toEqual(mockUser);
      expect(fetchMock).toHaveBeenCalledWith(
        `${API_BASE}/getMe`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('sendMessage()', () => {
    it('sends a message and returns it', async () => {
      fetchMock.mockResolvedValueOnce(apiOk(mockMessage));
      const bot = new TelegramBot(TOKEN);
      const result = await bot.sendMessage(100, 'hello');
      expect(result).toEqual(mockMessage);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ chat_id: 100, text: 'hello' });
    });

    it('merges send options into the request body', async () => {
      fetchMock.mockResolvedValueOnce(apiOk(mockMessage));
      const bot = new TelegramBot(TOKEN);
      await bot.sendMessage(100, 'hello', { parse_mode: 'HTML', disable_notification: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ parse_mode: 'HTML', disable_notification: true });
    });
  });

  describe('sendChatAction()', () => {
    it('sends the action and returns true', async () => {
      fetchMock.mockResolvedValueOnce(apiOk(true));
      const bot = new TelegramBot(TOKEN);
      const result = await bot.sendChatAction(100, 'typing');
      expect(result).toBe(true);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toEqual({ chat_id: 100, action: 'typing' });
    });
  });

  describe('answerCallbackQuery()', () => {
    it('answers with only the query id', async () => {
      fetchMock.mockResolvedValueOnce(apiOk(true));
      const bot = new TelegramBot(TOKEN);
      const result = await bot.answerCallbackQuery('qid-1');
      expect(result).toBe(true);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ callback_query_id: 'qid-1' });
    });

    it('passes text and show_alert options', async () => {
      fetchMock.mockResolvedValueOnce(apiOk(true));
      const bot = new TelegramBot(TOKEN);
      await bot.answerCallbackQuery('qid-1', { text: 'Done!', show_alert: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ text: 'Done!', show_alert: true });
    });
  });

  describe('editMessageText()', () => {
    it('edits a message and returns the updated message', async () => {
      const edited = { ...mockMessage, text: 'updated' };
      fetchMock.mockResolvedValueOnce(apiOk(edited));
      const bot = new TelegramBot(TOKEN);
      const result = await bot.editMessageText('updated', { chat_id: 100, message_id: 1 });
      expect(result).toEqual(edited);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ text: 'updated', chat_id: 100, message_id: 1 });
    });
  });

  // ─── Error handling & retry ───────────────────────────────────────────────

  describe('error handling', () => {
    it('throws immediately on a non-retryable 4xx API error', async () => {
      fetchMock.mockResolvedValueOnce(apiError('Bad Request', 400));
      const bot = new TelegramBot(TOKEN);
      await expect(bot.getMe()).rejects.toThrow('Bad Request');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries on HTTP 429 and succeeds on the next attempt', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(apiError('Too Many Requests', 429))
        .mockResolvedValueOnce(apiOk(mockUser));
      const bot = new TelegramBot(TOKEN, { requestRetries: 1 });
      const promise = bot.getMe();
      await vi.runAllTimersAsync();
      expect(await promise).toEqual(mockUser);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on HTTP 500 and succeeds on the next attempt', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(apiError('Internal Server Error', 500))
        .mockResolvedValueOnce(apiOk(mockUser));
      const bot = new TelegramBot(TOKEN, { requestRetries: 1 });
      const promise = bot.getMe();
      await vi.runAllTimersAsync();
      expect(await promise).toEqual(mockUser);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries on a retryable network error', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockRejectedValueOnce(new Error('fetch failed'))
        .mockResolvedValueOnce(apiOk(mockUser));
      const bot = new TelegramBot(TOKEN, { requestRetries: 1 });
      const promise = bot.getMe();
      await vi.runAllTimersAsync();
      expect(await promise).toEqual(mockUser);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all retries', async () => {
      vi.useFakeTimers();
      fetchMock.mockRejectedValue(new Error('fetch failed'));
      const bot = new TelegramBot(TOKEN, { requestRetries: 2 });

      // Attach rejection handler before running timers to avoid unhandled rejection
      const assertion = expect(bot.getMe()).rejects.toThrow('fetch failed');
      await vi.runAllTimersAsync();
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('does not retry on a non-retryable 4xx error', async () => {
      fetchMock.mockResolvedValue(apiError('Forbidden', 403));
      const bot = new TelegramBot(TOKEN, { requestRetries: 2 });
      await expect(bot.getMe()).rejects.toThrow('Forbidden');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Polling ──────────────────────────────────────────────────────────────

  describe('polling', () => {
    it('invokes message handlers for incoming messages', async () => {
      fetchMock
        .mockResolvedValueOnce(apiOk([{ update_id: 1, message: mockMessage }]))
        .mockResolvedValue(apiOk([]));

      const handler = vi.fn();
      const bot = new TelegramBot(TOKEN, { polling: true });
      bot.on('message', handler);

      await flushPromises();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(mockMessage);
      bot.stopPolling();
    });

    it('invokes message handlers for edited messages', async () => {
      fetchMock
        .mockResolvedValueOnce(apiOk([{ update_id: 1, edited_message: mockMessage }]))
        .mockResolvedValue(apiOk([]));

      const handler = vi.fn();
      const bot = new TelegramBot(TOKEN, { polling: true });
      bot.on('message', handler);

      await flushPromises();

      expect(handler).toHaveBeenCalledWith(mockMessage);
      bot.stopPolling();
    });

    it('invokes multiple registered message handlers', async () => {
      fetchMock
        .mockResolvedValueOnce(apiOk([{ update_id: 1, message: mockMessage }]))
        .mockResolvedValue(apiOk([]));

      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const bot = new TelegramBot(TOKEN, { polling: true });
      bot.on('message', handlerA);
      bot.on('message', handlerB);

      await flushPromises();

      expect(handlerA).toHaveBeenCalledWith(mockMessage);
      expect(handlerB).toHaveBeenCalledWith(mockMessage);
      bot.stopPolling();
    });

    it('invokes polling_error handler on fetch failure', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      const errorHandler = vi.fn();
      const bot = new TelegramBot(TOKEN, { polling: true });
      bot.on('polling_error', errorHandler);

      await flushPromises();
      bot.stopPolling();

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });

    it('advances the offset after receiving updates', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(apiOk([{ update_id: 5, message: mockMessage }]))
        .mockResolvedValue(apiOk([]));

      const bot = new TelegramBot(TOKEN, { polling: true });

      await vi.advanceTimersByTimeAsync(150); // let first poll + interval complete

      const secondCallBody = JSON.parse(
        (fetchMock.mock.calls[1][1] as RequestInit).body as string,
      );
      expect(secondCallBody.offset).toBe(6);
      bot.stopPolling();
    });

    it('stopPolling() prevents further fetch calls', async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(apiOk([]));

      const bot = new TelegramBot(TOKEN, { polling: true });

      await vi.advanceTimersByTimeAsync(50); // let the first poll settle
      bot.stopPolling();
      const callCount = fetchMock.mock.calls.length;

      await vi.advanceTimersByTimeAsync(500); // time passes but no more polls

      expect(fetchMock.mock.calls.length).toBe(callCount);
    });
  });
});
