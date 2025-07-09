import { ChatSession, useChatStore } from "../store";

import { StoreKey } from "../constant";
import { merge } from "./merge";
import { updateSessionStats } from "./session";

type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];
type NonFunctionFields<T> = Pick<T, NonFunctionKeys<T>>;

export function getNonFunctionFileds<T extends object>(obj: T) {
  const ret: any = {};

  Object.entries(obj).map(([k, v]) => {
    if (typeof v !== "function") {
      ret[k] = v;
    }
  });

  return ret as NonFunctionFields<T>;
}

export type GetStoreState<T> = T extends { getState: () => infer U }
  ? NonFunctionFields<U>
  : never;

const LocalStateSetters = {
  [StoreKey.Chat]: useChatStore.setState,
} as const;

const LocalStateGetters = {
  [StoreKey.Chat]: () => {
    try {
      return getNonFunctionFileds(useChatStore.getState());
    } catch (error) {
      console.error("[Sync] Failed to get chat store state:", error);
      // 返回默认的聊天状态结构，包含一个基本的空会话
      return {
        accessCode: "",
        models: [],
        sessions: [
          {
            id: "default",
            topic: "新的对话",
            messages: [],
            messageCount: 0,
            status: "normal" as const,
            model: "jyj.cx/flash",
            lastUpdate: Date.now(),
            longInputMode: false,
            isModelManuallySelected: false,
          },
        ],
        currentSessionIndex: 0,
        lastUpdateTime: 0,
      };
    }
  },
} as const;

export type AppState = {
  [k in keyof typeof LocalStateGetters]: ReturnType<
    (typeof LocalStateGetters)[k]
  >;
};

type Merger<T extends keyof AppState, U = AppState[T]> = (
  localState: U,
  remoteState: U,
) => U;

type StateMerger = {
  [K in keyof AppState]: Merger<K>;
};

// 确保会话对象包含所有必需的属性
function ensureSessionComplete(session: any): ChatSession {
  return {
    ...session,
    messageCount: session.messageCount ?? (session.messages?.length || 0),
    status:
      session.status ??
      (() => {
        const messages = session.messages || [];
        if (messages.length === 0) return "normal";
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.isError) return "error";
        if (lastMessage.role === "user") return "pending";
        return "normal";
      })(),
  };
}

// we merge remote state to local state
const MergeStates: StateMerger = {
  [StoreKey.Chat]: (localState, remoteState) => {
    // merge sessions
    const localSessions: Record<string, ChatSession> = {};
    localState.sessions.forEach(
      (s) => (localSessions[s.id] = ensureSessionComplete(s)),
    );

    remoteState.sessions.forEach((remoteSession) => {
      // skip empty chats
      if (remoteSession.messages.length === 0) return;

      const completeRemoteSession = ensureSessionComplete(remoteSession);
      const localSession = localSessions[completeRemoteSession.id];
      if (!localSession) {
        // if remote session is new, just merge it
        localState.sessions.push(completeRemoteSession);
      } else {
        // if both have the same session id, merge the messages
        const localMessageIds = new Set(localSession.messages.map((v) => v.id));
        completeRemoteSession.messages.forEach((m) => {
          if (!localMessageIds.has(m.id)) {
            localSession.messages.push(m);
          }
        });

        // sort local messages with date field in asc order
        localSession.messages.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

        // update session stats after merging messages
        updateSessionStats(localSession);
      }
    });

    // sort local sessions with date field in desc order
    localState.sessions.sort(
      (a, b) =>
        new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime(),
    );

    return localState;
  },
};

export function getLocalAppState() {
  const appState = Object.fromEntries(
    Object.entries(LocalStateGetters).map(([key, getter]) => {
      return [key, getter()];
    }),
  ) as AppState;

  return appState;
}

export function setLocalAppState(appState: AppState) {
  Object.entries(LocalStateSetters).forEach(([key, setter]) => {
    setter(appState[key as keyof AppState]);
  });
}

export function mergeAppState(localState: AppState, remoteState: AppState) {
  Object.keys(localState).forEach(<T extends keyof AppState>(k: string) => {
    const key = k as T;
    const localStoreState = localState[key];
    const remoteStoreState = remoteState[key];
    MergeStates[key](localStoreState, remoteStoreState);
  });

  return localState;
}

/**
 * Merge state with `lastUpdateTime`, older state will be override
 */
export function mergeWithUpdate<T extends { lastUpdateTime?: number }>(
  localState: T,
  remoteState: T,
) {
  const localUpdateTime = localState.lastUpdateTime ?? 0;
  const remoteUpdateTime = localState.lastUpdateTime ?? 1;

  if (localUpdateTime < remoteUpdateTime) {
    merge(remoteState, localState);
    return { ...remoteState };
  } else {
    merge(localState, remoteState);
    return { ...localState };
  }
}
