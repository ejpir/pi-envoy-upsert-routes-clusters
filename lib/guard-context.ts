import type { ThemeLike } from "./types.ts";

type GuardTheme = ThemeLike & {
  fg: (color: string, text: string) => string;
};

type GuardNotificationLevel = "info" | "warning" | "error" | "success";

type GuardCustomUiController = {
  requestRender(): void;
};

type GuardCustomUiRenderer = {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
};

type GuardUi = {
  notify(message: string, level: GuardNotificationLevel): void;
  setStatus(key: string, value?: string): void;
  setWorkingMessage(message?: string): void;
  setHiddenThinkingLabel(message?: string): void;
  setToolsExpanded(expanded: boolean): void;
  setEditorText(text: string): void;
  custom<T>(
    factory: (
      tui: GuardCustomUiController,
      theme: GuardTheme,
      kb: unknown,
      done: (value: T) => void,
    ) => GuardCustomUiRenderer,
  ): Promise<T>;
};

type GuardContext = {
  cwd: string;
  hasUI: boolean;
  signal?: AbortSignal;
  model?: {
    provider?: string;
    id?: string;
  };
  ui: GuardUi;
};

export type {
  GuardContext,
  GuardCustomUiController,
  GuardCustomUiRenderer,
  GuardNotificationLevel,
  GuardTheme,
  GuardUi,
};
