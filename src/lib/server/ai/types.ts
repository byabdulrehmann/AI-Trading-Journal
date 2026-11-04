import type { JarvisContext } from "./context";

export interface ModelInfo {
  id: string;
  displayName: string;
}

export interface ProviderStatus {
  configured: boolean;
  /** Why the provider can't be used, in plain words. */
  reason?: string;
  /** Whether data leaves this computer when the provider is used. */
  external: boolean;
}

export interface StreamRequest {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  context: JarvisContext;
  signal: AbortSignal;
}

/**
 * Jarvis talks to models only through this interface, so the UI and routes
 * never depend on one vendor's SDK.
 */
export interface JarvisProvider {
  id: string;
  label: string;
  status(): ProviderStatus;
  /** Discovers models from the provider. Throws ProviderError on failure. */
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  defaultModel: string;
  stream(req: StreamRequest): AsyncIterable<string>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "auth" | "rate_limited" | "unavailable" | "bad_request" | "refused" | "timeout",
    readonly retryable = false,
  ) {
    super(message);
  }
}
