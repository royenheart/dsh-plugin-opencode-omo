// Pure model-visible tool policy for the opencode-omo preset.
//
// The harness no longer lets `system-prompt/assemble` rewrite tool schemas:
// tool declarations are owned by step admission and each registration's
// `when` condition. Keep the opencode/omo visibility rules here so the
// registrations and the execution-side gate share one predicate.
import { applyOmoDelegationCatalog } from './delegation-surface.mjs'
import { applyOmoLspCatalog } from './lsp-surface.mjs'

/**
 * opencode's model-dependent file-tool choice: GPT non-oss models (except
 * gpt-4) get apply_patch instead of edit/write.
 * @param model - provider model id.
 * @returns whether apply_patch is the file-editing tool for this route.
 */
export function opencodeUsesPatch(model) {
  return typeof model === 'string'
    && model.includes('gpt-')
    && !model.includes('oss')
    && !model.includes('gpt-4')
}

/** Whether one tool name survives a delegated child's inherited restriction. */
export function toolAllowed(name, restriction, allowSendMessage = false) {
  // Children must be able to return their result even when the role's allow
  // list is narrow (multimodal-looker keeps only read/read_image).
  if (allowSendMessage && name === 'send_message') return true
  if (restriction === undefined) return true
  if (Array.isArray(restriction.allow)) return restriction.allow.includes(name)
  if (Array.isArray(restriction.deny)) return !restriction.deny.includes(name)
  return true
}

/**
 * Apply the omo hidden-name catalogs, role restrictions, and opencode's
 * per-model file-tool gate to one visible tool list.
 * @param tools - candidate tool schemas/definitions.
 * @param model - route model id used for file-tool gating.
 * @param restriction - delegated child restriction, if any.
 * @param allowSendMessage - whether this is a delegated child.
 * @returns the surviving tools, or the input when it is not an array.
 */
export function opencodeTools(tools, model, restriction, allowSendMessage = false) {
  if (!Array.isArray(tools)) return tools
  const usePatch = opencodeUsesPatch(model)
  return applyOmoLspCatalog(applyOmoDelegationCatalog(tools, { allowSendMessage })).filter(tool => {
    // Role restrictions apply to every model family, including the write
    // tools. Otherwise a read-only specialist on a GPT route could actually
    // execute apply_patch while the non-GPT view only looked inconsistent.
    if (!toolAllowed(tool.name, restriction, allowSendMessage)) return false
    if (tool.name === 'apply_patch') return usePatch
    if (tool.name === 'edit' || tool.name === 'write') return !usePatch
    return true
  })
}

/**
 * Single-name admission check used by per-agent registration conditions.
 * @param name - tool name.
 * @param model - route model id.
 * @param restriction - delegated child restriction, if any.
 * @param allowSendMessage - whether this is a delegated child.
 * @returns whether the model may see and call this tool for the step.
 */
export function toolVisible(name, model, restriction, allowSendMessage = false) {
  return opencodeTools([{ name }], model, restriction, allowSendMessage).length === 1
}
