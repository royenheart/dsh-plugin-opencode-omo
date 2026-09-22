#!/usr/bin/env bash
# Create the two isolated homes used by the equivalence bench:
#   $DSH_HOME_BENCH        dsh web profile bundling this plugin
#   $OPENCODE_CONFIG_HOME  opencode config with oh-my-openagent + dpsk v4 pro
# Nothing under these homes is committed. No absolute machine paths or secrets
# are embedded; required input comes from env vars.
set -euo pipefail

: "${DSH_ROOT:?set DSH_ROOT to the deepseek-harness checkout}"
: "${PLUGIN_ROOT:?set PLUGIN_ROOT to this plugin checkout}"
DSH_HOME_BENCH="${DSH_HOME_BENCH:-$PLUGIN_ROOT/.bench/dsh-home}"
OPENCODE_CONFIG_HOME="${OPENCODE_CONFIG_HOME:-$PLUGIN_ROOT/.bench/opencode-home}"
DSH_PROFILE="${DSH_PROFILE:-omo-bench}"
DEEPSEEK_MODEL="${DEEPSEEK_MODEL:-deepseek-v4-pro}"

echo "dsh home:    $DSH_HOME_BENCH"
echo "opencode:    $OPENCODE_CONFIG_HOME"
echo "model:       deepseek-official/$DEEPSEEK_MODEL"

# ---- dsh isolated home ------------------------------------------------------
rm -rf "$DSH_HOME_BENCH"
mkdir -p "$DSH_HOME_BENCH/profiles/$DSH_PROFILE/node_modules/@royenheart"

# Every in-box bundle/dependency is materialized by dsh itself into
# $DSH_HOME/profiles/node_modules on first boot (healProfilesModuleFallback).
# Do NOT symlink this directory over the checkout's apps/cli/node_modules:
# dsh would rewrite that dependency tree. Only the plugin is profile-local.
mkdir -p "$DSH_HOME_BENCH/profiles/node_modules"
ln -s "$PLUGIN_ROOT" "$DSH_HOME_BENCH/profiles/$DSH_PROFILE/node_modules/@royenheart/dsh-plugin-opencode-omo"

# 0.1.7 presets are @deepseek-ai/dsh-agent-preset declaration rows carried by
# the bundle patch below; the former $DSH_HOME/.agent-presets discovery root is
# no longer read, so nothing is linked there.
cat > "$DSH_HOME_BENCH/profiles/$DSH_PROFILE/package.json" <<JSON
{
  "name": "dsh-profile-$DSH_PROFILE",
  "private": true,
  "dependencies": {
    "@royenheart/dsh-plugin-opencode-omo": "link:$PLUGIN_ROOT"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@royenheart/dsh-plugin-opencode-omo"
      ]
    }
  }
}
JSON

cat > "$DSH_HOME_BENCH/settings.yaml" <<YAML
agent-default-model:
  provider: deepseek-official
  model: $DEEPSEEK_MODEL
YAML

# ---- opencode isolated config ----------------------------------------------
rm -rf "$OPENCODE_CONFIG_HOME"
mkdir -p "$OPENCODE_CONFIG_HOME/opencode"
# Reuse the machine's installed oh-my-openagent plugin; package.json/node_modules
# stay machine-local and are only symlinked/copied into the ephemeral home.
if [[ -f "${OPMO_PLUGIN_DIR:-$HOME/.config/opencode}/package.json" ]]; then
  cp "${OPMO_PLUGIN_DIR:-$HOME/.config/opencode}/package.json" "$OPENCODE_CONFIG_HOME/opencode/package.json"
fi
if [[ -d "${OPMO_PLUGIN_DIR:-$HOME/.config/opencode}/node_modules" ]]; then
  ln -s "${OPMO_PLUGIN_DIR:-$HOME/.config/opencode}/node_modules" "$OPENCODE_CONFIG_HOME/opencode/node_modules"
fi
cat > "$OPENCODE_CONFIG_HOME/opencode/opencode.json" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "plugin": ["oh-my-openagent@latest"],
  "autoupdate": false,
  "model": "dpsk/$DEEPSEEK_MODEL",
  "small_model": "dpsk/$DEEPSEEK_MODEL",
  "provider": {
    "dpsk": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepSeek official",
      "options": {
        "baseURL": "https://api.deepseek.com/v1",
        "apiKey": "{env:DEEPSEEK_API_KEY}"
      },
      "models": {
        "$DEEPSEEK_MODEL": { "name": "DeepSeek V4 Pro" }
      }
    }
  }
}
JSON

echo "done"
