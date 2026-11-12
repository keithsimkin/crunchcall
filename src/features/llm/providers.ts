import type { LlmProvider, LlmCompletionRequest, LlmCompletionResult } from './types'

/** Placeholder until the local runtime is wired. */
export const localLlmProvider: LlmProvider = {
  id: 'local',
  mode: 'local',
  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    return {
      text: `[local stub] Would summarize meeting ${request.meetingId}`,
      mode: 'local',
      model: 'local-stub',
    }
  },
}

/** Placeholder until BYOK clients are wired. */
export function createByokProvider(
  provider: 'openai' | 'anthropic',
): LlmProvider {
  return {
    id: `byok:${provider}`,
    mode: 'byok',
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      return {
        text: `[byok:${provider} stub] Would summarize meeting ${request.meetingId}`,
        mode: 'byok',
        model: `${provider}-stub`,
      }
    },
  }
}
