/**
 * Detection of dsh-side seams the plugin can use, plus the degradation path
 * taken when the harness predates the seam. dsh is still under development, so
 * a profile can easily run a build that lacks `patches/0001-…-assistant-prefill`;
 * the plugin must keep working and must tell the user what degraded.
 *
 * The seam has no runtime flag (the patch is structural), so the detector
 * resolves the installed `@deepseek-ai/dsh-agent-loop` entry and checks for
 * the compiled `decision.assistantPrefill` marker. It is read once per process.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Public compatibility snapshot served to the browser and consumed by the preset driver. */
export interface DshCompat {
  /** dsh records `PreStepDecision.assistantPrefill` (patched harness). */
  readonly assistantPrefill: boolean
  /** Max-steps strategy chosen for this harness. */
  readonly maxStepsMode: 'assistant-prefill' | 'system-prompt-section' | 'disabled'
  /** User-facing degradation notices (empty when fully supported). */
  readonly warnings: readonly string[]
  /** True when the detection itself failed (e.g. agent-loop package unresolvable). */
  readonly detectionFailed: boolean
}

export const ASSISTANT_PREFILL_WARNING = 'This dsh build lacks the agent/pre-step assistantPrefill patch: the maxSteps ceiling prompt is degraded to a system-prompt injection (same text, but in the system prompt rather than an assistant-role continuation). Apply patches/0001-agent-pre-step-assistant-prefill.patch and rebuild the harness.'
export const DETECTION_FAILED_WARNING = 'Could not confirm whether dsh supports assistantPrefill (@deepseek-ai/dsh-agent-loop resolution failed): the maxSteps ceiling prompt is degraded to a system-prompt injection.'

let cached: DshCompat | undefined

/** Read the installed agent-loop entry text for the structural marker. */
function agentLoopEntryText(): { ok: true; text: string } | { ok: false } {
  try {
    const entry = require.resolve('@deepseek-ai/dsh-agent-loop')
    return { ok: true, text: readFileSync(entry, 'utf8') }
  } catch {
    return { ok: false }
  }
}

/** Detect (and cache) the dsh capability snapshot for this process. */
export function detectDshCompat(): DshCompat {
  cached ??= computeDshCompat()
  return cached
}

function computeDshCompat(): DshCompat {
  const resolved = agentLoopEntryText()
  if (!resolved.ok) {
    return {
      assistantPrefill: false,
      maxStepsMode: 'system-prompt-section',
      warnings: [DETECTION_FAILED_WARNING],
      detectionFailed: true,
    }
  }
  const supported = resolved.text.includes('assistantPrefill')
  return {
    assistantPrefill: supported,
    maxStepsMode: supported ? 'assistant-prefill' : 'system-prompt-section',
    warnings: supported ? [] : [ASSISTANT_PREFILL_WARNING],
    detectionFailed: false,
  }
}

/** Exported for tests that want a fresh computation per harness build. */
export function _resetDshCompatCache(): void {
  cached = undefined
}
