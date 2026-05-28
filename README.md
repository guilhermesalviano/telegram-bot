# assistant-telegram-bot

A minimal, **zero-dependency** Telegram bot polling module for Node.js, written in TypeScript.

## Features

- 🚀 No external dependencies — uses native Node.js `fetch`
- 🔄 Long-polling with automatic retry and exponential backoff
- 📦 Full TypeScript support with type declarations
- 🧩 Simple high-level API (`initBot`) or direct class usage (`TelegramBot`)

## Requirements

- Node.js >= 18.0.0

## Installation

```bash
npm install assistant-telegram-bot
# or
pnpm add assistant-telegram-bot
```

## Usage

### Quick start with `initBot`

```ts
import { initBot } from 'assistant-telegram-bot';

const bot = initBot({
  token: 'YOUR_BOT_TOKEN',
  onMessage: (msg) => {
    console.log('Received:', msg.text);
    bot.sendMessage(msg.chat.id, `You said: ${msg.text}`);
  },
  onPollingError: (err) => console.error(err),
});
```

### Direct class usage

```ts
import { TelegramBot } from 'assistant-telegram-bot';

const bot = new TelegramBot('YOUR_BOT_TOKEN', { polling: true });

bot.on('message', async (msg) => {
  await bot.sendMessage(msg.chat.id, 'Hello!');
});

bot.on('polling_error', (err) => console.error(err));
```

## API

### `initBot(params)`

| Param | Type | Description |
|---|---|---|
| `token` | `string` | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `polling` | `boolean` | Enable polling (default: `true`) |
| `onMessage` | `(msg) => void \| Promise<void>` | Handler for incoming messages |
| `onPollingError` | `(err) => void` | Optional error handler |

### `getBot()`

Returns the current bot instance initialized by `initBot`. Throws if not initialized.

### `TelegramBot` class

| Method | Description |
|---|---|
| `sendMessage(chatId, text, options?)` | Send a text message |
| `sendChatAction(chatId, action)` | Send a chat action (e.g. `"typing"`) |
| `editMessageText(text, options?)` | Edit an existing message |
| `answerCallbackQuery(id, options?)` | Answer an inline keyboard callback |
| `getMe()` | Get bot info |
| `stopPolling()` | Stop the polling loop |
| `on('message', handler)` | Register a message handler |
| `on('polling_error', handler)` | Register a polling error handler |

## License

ISC
