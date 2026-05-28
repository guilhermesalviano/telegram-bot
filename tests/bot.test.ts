import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initBot, getBot, resetBotForTests } from '../src/bot';
import { TelegramBot } from '../src/client';

const TOKEN = 'test-token-123';

beforeEach(() => {
  resetBotForTests();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true, result: [] }) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getBot()', () => {
  it('throws if called before initBot()', () => {
    expect(() => getBot()).toThrow('Bot not initialized. Call initBot() first.');
  });
});

describe('initBot()', () => {
  it('returns a TelegramBot instance', () => {
    const bot = initBot({ token: TOKEN, onMessage: vi.fn() });
    expect(bot).toBeInstanceOf(TelegramBot);
  });

  it('enables polling by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, result: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    initBot({ token: TOKEN, onMessage: vi.fn() });

    // Give the first poll a chance to fire
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(fetchMock).toHaveBeenCalled();
  });

  it('respects polling: false', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    initBot({ token: TOKEN, polling: false, onMessage: vi.fn() });

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers the onMessage handler', async () => {
    const message = {
      message_id: 1,
      chat: { id: 42, type: 'private' as const },
      date: 1_000_000,
      text: 'hi',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message }] }) })
      .mockResolvedValue({ json: () => Promise.resolve({ ok: true, result: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const onMessage = vi.fn();
    initBot({ token: TOKEN, onMessage });

    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it('uses custom onPollingError handler instead of console.error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('poll failed'));
    vi.stubGlobal('fetch', fetchMock);

    const onPollingError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bot = initBot({ token: TOKEN, onMessage: vi.fn(), onPollingError });

    // Flush microtasks to process the first poll failure
    for (let i = 0; i < 10; i++) await Promise.resolve();
    bot.stopPolling();

    expect(onPollingError).toHaveBeenCalledWith(expect.any(Error));
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Telegram polling error'),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});

describe('getBot()', () => {
  it('returns the same bot instance created by initBot()', () => {
    const bot = initBot({ token: TOKEN, onMessage: vi.fn() });
    expect(getBot()).toBe(bot);
  });
});

describe('resetBotForTests()', () => {
  it('clears the bot so getBot() throws again', () => {
    initBot({ token: TOKEN, onMessage: vi.fn() });
    expect(() => getBot()).not.toThrow();

    resetBotForTests();

    expect(() => getBot()).toThrow('Bot not initialized. Call initBot() first.');
  });
});
