import { customProvider, gateway } from "ai";
import { openai } from "@ai-sdk/openai";
import { isTestEnvironment } from "../constants";
import { titleModel } from "./models";

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": titleModel,
        },
      });
    })()
  : null;

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  // Prefer direct OpenAI for openai/* models when an API key is configured.
  if (process.env.OPENAI_API_KEY && modelId.startsWith("openai/")) {
    const openaiModelId = modelId.replace("openai/", "");
    return openai(openaiModelId);
  }

  return gateway.languageModel(modelId);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  if (process.env.OPENAI_API_KEY && titleModel.id.startsWith("openai/")) {
    const openaiModelId = titleModel.id.replace("openai/", "");
    return openai(openaiModelId);
  }

  return gateway.languageModel(titleModel.id);
}
