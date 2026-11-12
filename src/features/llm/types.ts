export type LlmMode = 'local' | 'byok'

export type ByokProvider = 'openai' | 'anthropic'

export type LlmSettings =
  | { mode: 'local' }
  | {
      mode: 'byok'
      provider: ByokProvider
      /** Stored only in local secure settings — never committed */
      apiKeyRef: string
    }

export type LlmCompletionRequest = {
  system: string
  prompt: string
  meetingId: string
}

export type LlmCompletionResult = {
  text: string
  mode: LlmMode
  model: string
}

export interface LlmProvider {
  readonly id: string
  readonly mode: LlmMode
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>
}
