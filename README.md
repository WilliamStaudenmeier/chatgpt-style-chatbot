# ChatGPT Style Chatbot

An AI chatbot web app built with Next.js, the Vercel AI SDK, and a Radix-based UI stack.

![B9F7FCF3-637B-4F07-9840-D01D21301EB9_1_201_a](https://github.com/user-attachments/assets/1c92390e-18eb-4e56-9f09-5bb5aad897de)


## What This Project Does

This project provides a ChatGPT-style interface focused on quick AI education use cases.

Core behavior in this repo:

- Uses OpenAI as the default provider path in the app code when an OpenAI key is present.
- Defaults to the low-cost model `openai/gpt-5.4-nano`.
- Shows curated starter prompts for AI/ML topics.
- Locks model selection so non-default models appear disabled.
- Applies a per-session message cap of 3 user sends, then automatically redirects to the GitHub repository.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui + Radix primitives
- Radix Themes (`@radix-ui/themes`)
- Vercel AI SDK
- Auth.js (credentials + guest path)

## How The App Works

1. User submits a prompt from the chat composer.
2. Client sends message payload to `/api/chat` with the selected model id.
3. Server streams AI responses back to the UI.
4. UI renders messages, tools/capabilities, and artifacts where relevant.
5. Session message counter is tracked in `sessionStorage` and redirects after 3 messages.

## Radix Usage In This Project

This project uses Radix in two layers:

- Component primitives through the shadcn-style UI components (dialog, popover, select, tooltip, etc.).
- Theme system through `@radix-ui/themes` in the root layout.

Where to look:

- Radix Theme provider and styles: `app/layout.tsx`
- Theme variables and app-wide styling: `app/globals.css`
- Radix-backed UI elements: `components/ui/*`
- Model selector/popover examples: `components/ai-elements/model-selector.tsx`

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create local env file

Create `.env.local` in project root.

Minimum required values for local auth + OpenAI:

```bash
AUTH_SECRET=your-random-secret
OPENAI_API_KEY=your-openai-api-key
```

Optional values (depending on your feature usage):

- `POSTGRES_URL`
- `BLOB_READ_WRITE_TOKEN`
- `REDIS_URL`
- `AI_GATEWAY_API_KEY`

### 3. Run the app

```bash
npm run dev -- --port 3001
```

Open:

- `http://localhost:3001`

### 4. Production build check

```bash
npm run build
```

## Deployment

### GitHub

Repository:

- `https://github.com/WilliamStaudenmeier/chatgpt-style-chatbot`

### Vercel

1. Link project:

```bash
vercel link --yes --project chatgpt-style-chatbot
```

2. Add production env vars:

```bash
vercel env add AUTH_SECRET production --sensitive --yes --value "..."
vercel env add OPENAI_API_KEY production --sensitive --yes --value "..."
```

3. Deploy:

```bash
vercel deploy --prod --yes
```

## Project Notes

- If you change model behavior, update `lib/ai/models.ts` and `lib/ai/providers.ts` together.
- If you change session limit behavior, update `hooks/use-active-chat.tsx` and constants in `lib/constants.ts`.
- Keep secrets in environment variables only, never commit them.
