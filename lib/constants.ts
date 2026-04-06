import { generateDummyPassword } from "./db/utils";

export const isProductionEnvironment = process.env.NODE_ENV === "production";
export const isDevelopmentEnvironment = process.env.NODE_ENV === "development";
export const isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL ||
    process.env.PLAYWRIGHT ||
    process.env.CI_PLAYWRIGHT
);

export const guestRegex = /^guest-\d+$/;

export const DUMMY_PASSWORD = generateDummyPassword();

export const GITHUB_REPO_URL =
  "https://github.com/WilliamStaudenmeier/chatgpt-style-chatbot";

export const SESSION_MESSAGE_LIMIT = 3;
export const SESSION_MESSAGE_COUNT_KEY = "chat-session-message-count";

export const suggestions = [
  "What is the difference between Machine Learning and AI?",
  "Explain what RAG is in three sentences.",
  "In one sentence, explain what LLM means.",
  "What is the top AI company in terms of revenue?",
];
