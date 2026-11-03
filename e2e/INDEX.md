# End-to-end coverage

Each row is a user-visible feature of the plugins and the spec that exercises it. Written by dsh-migrate's agent; last checked against dsh-v0.2.2-alpha.3.

| Feature | Entry | Expected | Spec |
|---|---|---|---|
| `settings-section` | Account menu → Settings → opencode-omo | The plugin page opens with the opencode-omo heading, its alignment intro, and the selected 角色设置 tab. | `specs/role-settings.spec.ts::role settings page lists the complete omo role catalog` |
| `role-catalog` | Settings → opencode-omo → 角色设置 | All 14 omo role boxes render with display name, description, omo default chain, 主模型 selector, and the + fallback control. | `specs/role-settings.spec.ts::role settings page lists the complete omo role catalog` |
| `primary-model` | Role box → 主模型 menu | The menu offers 跟随当前, 使用 omo 默认, and the catalog models; the selection updates the role box and survives closing/reopening Settings. | `specs/role-settings.spec.ts::primary model selector offers follow, omo default, and a pinned model with reasoning effort` |
| `reasoning-effort` | Role box with a pinned reasoning model → effort select | The effort select appears under 主模型 with 默认 effort plus adapter efforts; the chosen effort is saved and survives reopening Settings. | `specs/role-settings.spec.ts::primary model selector offers follow, omo default, and a pinned model with reasoning effort` |
| `fallback-add` | Role box → + (添加 <role> fallback 模型) | A model list opens below the role box with a search field; a picked model becomes a chip and the list stays open for repeated additions; picking the same model again shows 该模型已在 fallback 列表中. | `specs/role-settings.spec.ts::fallback add panel appends chips, supports repeated additions, and rejects duplicates` |
| `fallback-search` | Fallback panel → 搜索模型… | Typing filters the offered models; a non-matching query shows 没有匹配的模型. | `specs/role-settings.spec.ts::fallback model search filters the list and reports no matches` |
| `fallback-cancel` | Fallback panel → 取消, the + toggle, an outside click, or Escape | The panel closes without adding a fallback chip. | `specs/role-settings.spec.ts::fallback panel cancel, toggle, outside click, and Escape add nothing` |
| `fallback-remove` | Fallback chip → × (移除 <model>) | The chip is removed, and the Fallback 模型 list disappears once no chips remain. | `specs/role-settings.spec.ts::fallback chips persist across reopening and can be removed` |
| `fallback-persistence` | Add a fallback chip → close and reopen Settings | The fallback chip is still shown under the role box after reopening the plugin page. | `specs/role-settings.spec.ts::fallback chips persist across reopening and can be removed` |
