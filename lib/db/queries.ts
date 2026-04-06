import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type Suggestion,
  stream,
  suggestion,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

const hasDatabase = Boolean(
  process.env.POSTGRES_URL && process.env.POSTGRES_URL !== "****"
);

const client = hasDatabase ? postgres(process.env.POSTGRES_URL as string) : null;
const db = hasDatabase ? drizzle(client!) : null;

const memoryUsers: Array<{ id: string; email: string; password: string | null }> = [];
const memoryChats: Chat[] = [];
const memoryMessages: DBMessage[] = [];
const memoryVotes: Array<{ chatId: string; messageId: string; isUpvoted: boolean }> = [];
const memoryDocuments: Array<{
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
  createdAt: Date;
}> = [];
const memorySuggestions: Suggestion[] = [];
const memoryStreams: Array<{ id: string; chatId: string; createdAt: Date }> = [];

export async function getUser(email: string): Promise<User[]> {
  if (!hasDatabase) {
    return memoryUsers.filter((u) => u.email === email) as unknown as User[];
  }

  try {
    return await db!.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  if (!hasDatabase) {
    memoryUsers.push({ id: generateUUID(), email, password: hashedPassword });
    return;
  }

  try {
    return await db!.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  if (!hasDatabase) {
    const guestUser = { id: generateUUID(), email, password };
    memoryUsers.push(guestUser);
    return [{ id: guestUser.id, email: guestUser.email }];
  }

  try {
    return await db!.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  if (!hasDatabase) {
    memoryChats.push({ id, createdAt: new Date(), userId, title, visibility } as Chat);
    return;
  }

  try {
    return await db!.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  if (!hasDatabase) {
    const chatIndex = memoryChats.findIndex((c) => c.id === id);
    if (chatIndex < 0) return null;

    const [deleted] = memoryChats.splice(chatIndex, 1);
    for (let i = memoryMessages.length - 1; i >= 0; i -= 1) {
      if (memoryMessages[i].chatId === id) memoryMessages.splice(i, 1);
    }
    for (let i = memoryVotes.length - 1; i >= 0; i -= 1) {
      if (memoryVotes[i].chatId === id) memoryVotes.splice(i, 1);
    }
    for (let i = memoryStreams.length - 1; i >= 0; i -= 1) {
      if (memoryStreams[i].chatId === id) memoryStreams.splice(i, 1);
    }
    return deleted;
  }

  try {
    await db!.delete(vote).where(eq(vote.chatId, id));
    await db!.delete(message).where(eq(message.chatId, id));
    await db!.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db!
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  if (!hasDatabase) {
    const ids = memoryChats.filter((c) => c.userId === userId).map((c) => c.id);
    if (!ids.length) return { deletedCount: 0 };

    for (let i = memoryChats.length - 1; i >= 0; i -= 1) {
      if (memoryChats[i].userId === userId) memoryChats.splice(i, 1);
    }
    for (let i = memoryMessages.length - 1; i >= 0; i -= 1) {
      if (ids.includes(memoryMessages[i].chatId)) memoryMessages.splice(i, 1);
    }
    for (let i = memoryVotes.length - 1; i >= 0; i -= 1) {
      if (ids.includes(memoryVotes[i].chatId)) memoryVotes.splice(i, 1);
    }
    for (let i = memoryStreams.length - 1; i >= 0; i -= 1) {
      if (ids.includes(memoryStreams[i].chatId)) memoryStreams.splice(i, 1);
    }
    return { deletedCount: ids.length };
  }

  try {
    const userChats = await db!
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db!.delete(vote).where(inArray(vote.chatId, chatIds));
    await db!.delete(message).where(inArray(message.chatId, chatIds));
    await db!.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db!
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  if (!hasDatabase) {
    const sorted = [...memoryChats]
      .filter((c) => c.userId === id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let filtered = sorted;
    if (startingAfter) {
      const anchor = sorted.find((c) => c.id === startingAfter);
      if (!anchor) {
        throw new ChatbotError("not_found:database", `Chat with id ${startingAfter} not found`);
      }
      filtered = sorted.filter((c) => c.createdAt > anchor.createdAt);
    } else if (endingBefore) {
      const anchor = sorted.find((c) => c.id === endingBefore);
      if (!anchor) {
        throw new ChatbotError("not_found:database", `Chat with id ${endingBefore} not found`);
      }
      filtered = sorted.filter((c) => c.createdAt < anchor.createdAt);
    }

    const hasMore = filtered.length > limit;
    return { chats: hasMore ? filtered.slice(0, limit) : filtered, hasMore };
  }

  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<unknown>) =>
      db!
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db!
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db!
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new ChatbotError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  if (!hasDatabase) {
    return memoryChats.find((c) => c.id === id) ?? null;
  }

  try {
    const [selectedChat] = await db!.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  if (!hasDatabase) {
    memoryMessages.push(...messages);
    return;
  }

  try {
    return await db!.insert(message).values(messages);
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save messages");
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  if (!hasDatabase) {
    const msg = memoryMessages.find((m) => m.id === id);
    if (msg) msg.parts = parts;
    return;
  }

  try {
    return await db!.update(message).set({ parts }).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to update message");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  if (!hasDatabase) {
    return [...memoryMessages]
      .filter((m) => m.chatId === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  try {
    return await db!
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  if (!hasDatabase) {
    const existing = memoryVotes.find((v) => v.messageId === messageId);
    if (existing) {
      existing.isUpvoted = type === "up";
      return;
    }
    memoryVotes.push({ chatId, messageId, isUpvoted: type === "up" });
    return;
  }

  try {
    const [existingVote] = await db!
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db!
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db!.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  if (!hasDatabase) {
    return memoryVotes.filter((v) => v.chatId === id);
  }

  try {
    return await db!.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  if (!hasDatabase) {
    const doc = { id, title, kind, content, userId, createdAt: new Date() };
    memoryDocuments.push(doc);
    return [doc];
  }

  try {
    return await db!
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (_error) {
    throw new ChatbotError("bad_request:database", "Failed to save document");
  }
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  if (!hasDatabase) {
    const docs = memoryDocuments.filter((d) => d.id === id);
    const latest = docs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }
    latest.content = content;
    return [latest];
  }

  try {
    const docs = await db!
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt))
      .limit(1);

    const latest = docs[0];
    if (!latest) {
      throw new ChatbotError("not_found:database", "Document not found");
    }

    return await db!
      .update(document)
      .set({ content })
      .where(and(eq(document.id, id), eq(document.createdAt, latest.createdAt)))
      .returning();
  } catch (_error) {
    if (_error instanceof ChatbotError) {
      throw _error;
    }
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update document content"
    );
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  if (!hasDatabase) {
    return [...memoryDocuments]
      .filter((d) => d.id === id)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  try {
    const documents = await db!
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  if (!hasDatabase) {
    return [...memoryDocuments]
      .filter((d) => d.id === id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  try {
    const [selectedDocument] = await db!
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  if (!hasDatabase) {
    for (let i = memorySuggestions.length - 1; i >= 0; i -= 1) {
      if (
        memorySuggestions[i].documentId === id &&
        memorySuggestions[i].documentCreatedAt > timestamp
      ) {
        memorySuggestions.splice(i, 1);
      }
    }

    const deleted: typeof memoryDocuments = [];
    for (let i = memoryDocuments.length - 1; i >= 0; i -= 1) {
      if (memoryDocuments[i].id === id && memoryDocuments[i].createdAt > timestamp) {
        deleted.push(memoryDocuments[i]);
        memoryDocuments.splice(i, 1);
      }
    }
    return deleted;
  }

  try {
    await db!
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db!
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  if (!hasDatabase) {
    memorySuggestions.push(...suggestions);
    return;
  }

  try {
    return await db!.insert(suggestion).values(suggestions);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  if (!hasDatabase) {
    return memorySuggestions.filter((s) => s.documentId === documentId);
  }

  try {
    return await db!
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  if (!hasDatabase) {
    return memoryMessages.filter((m) => m.id === id);
  }

  try {
    return await db!.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  if (!hasDatabase) {
    const messageIds = memoryMessages
      .filter((m) => m.chatId === chatId && m.createdAt >= timestamp)
      .map((m) => m.id);

    if (messageIds.length > 0) {
      for (let i = memoryVotes.length - 1; i >= 0; i -= 1) {
        if (memoryVotes[i].chatId === chatId && messageIds.includes(memoryVotes[i].messageId)) {
          memoryVotes.splice(i, 1);
        }
      }

      for (let i = memoryMessages.length - 1; i >= 0; i -= 1) {
        if (memoryMessages[i].chatId === chatId && messageIds.includes(memoryMessages[i].id)) {
          memoryMessages.splice(i, 1);
        }
      }
    }
    return;
  }

  try {
    const messagesToDelete = await db!
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db!
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db!
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  if (!hasDatabase) {
    const target = memoryChats.find((c) => c.id === chatId);
    if (target) {
      target.visibility = visibility;
    }
    return;
  }

  try {
    return await db!.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  if (!hasDatabase) {
    const target = memoryChats.find((c) => c.id === chatId);
    if (target) {
      target.title = title;
    }
    return;
  }

  try {
    return await db!.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch (_error) {
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  if (!hasDatabase) {
    const cutoffTime = new Date(Date.now() - differenceInHours * 60 * 60 * 1000);
    const userChatIds = new Set(memoryChats.filter((c) => c.userId === id).map((c) => c.id));
    return memoryMessages.filter(
      (m) => userChatIds.has(m.chatId) && m.createdAt >= cutoffTime && m.role === "user"
    ).length;
  }

  try {
    const cutoffTime = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db!
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, cutoffTime),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  if (!hasDatabase) {
    memoryStreams.push({ id: streamId, chatId, createdAt: new Date() });
    return;
  }

  try {
    await db!
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  if (!hasDatabase) {
    return [...memoryStreams]
      .filter((s) => s.chatId === chatId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((s) => s.id);
  }

  try {
    const streamIds = await db!
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}
