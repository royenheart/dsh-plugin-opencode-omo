#!/usr/bin/env python3
"""Install/uninstall the @royenheart/dsh-plugin-opencode-omo plugin into a dsh profile.

The plugin is a dsh BUNDLE whose patch declares its host row (role registry +
volatile settings entry) and the official `@deepseek-ai/dsh-agent-preset` row
for `opencode-omo`. No user-preset-root copy is published: the bundle
declaration is the single roster entry on 0.2.1.

Installing it requires:

1. a symlink of the package into the profile node_modules,
2. adding it to the profile dsh.profile.bundles list (plus a link: dependency).

Usage:
    python3 install.py install [--profile web] [--home ~/.dsh]
    python3 install.py uninstall [--profile web] [--home ~/.dsh]

Requires the Python standard library plus Node.js/npm. Built bundles are not
versioned: `install.py` always builds the repository's own toolchain
(`npm ci` when the toolchain is missing or package-lock.json is newer, then
`npm run build`) before installing; missing npm, a failed install/build,
missing artifacts, or missing harness links report an actionable error.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

PACKAGE = "@royenheart/dsh-plugin-opencode-omo"

# LSP servers the preset preconfigures. The preset now self-disables its
# `lsp-stdio` row when a command is missing, so a missing server never breaks
# the whole mode; installation still reports the gap with the fix command.
LSP_SERVER_COMMANDS = {
    "typescript": (
        "typescript-language-server",
        "npm install -g typescript-language-server typescript",
    ),
}


def repo_root() -> Path:
    return Path(__file__).resolve().parent


def profile_dir(home: str, profile: str) -> Path:
    return Path(home).expanduser() / "profiles" / profile


def node_modules_pkg(profile: Path) -> Path:
    return profile / "node_modules" / PACKAGE


def read_json(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def ensure_profile(profile: Path) -> None:
    manifest = profile / "package.json"
    if not manifest.exists():
        raise SystemExit(
            "profile manifest not found: " + str(manifest)
            + " - initialize the profile first (dsh plugin add)"
        )


def shared_node_modules(home: str) -> Path:
    """The shared profile module fallback tree (`profiles/node_modules`)."""
    return Path(home).expanduser() / "profiles" / "node_modules"


def dsh_install_root(home: str) -> Path:
    """Resolve the dsh installation root from the shared `dsh` package link."""
    anchor = shared_node_modules(home) / "@deepseek-ai" / "dsh"
    if not anchor.is_symlink():
        raise SystemExit("cannot locate the dsh installation anchor: " + str(anchor))
    apps_cli = Path(os.readlink(anchor)).resolve()
    return apps_cli.parent.parent


def ensure_link(link: Path, target: Path) -> None:
    """Create/replace a symlink to `target`; refuse to clobber real paths."""
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink():
        if Path(os.readlink(link)).resolve() == target.resolve():
            return
        link.unlink()
    elif link.exists():
        raise SystemExit("refusing to overwrite existing path: " + str(link))
    link.symlink_to(target, target_is_directory=True)


def user_preset_dir(home: str) -> Path:
    """dsh-agent-presets' native user root, appended to every roster."""
    return Path(home).expanduser() / ".agent-presets"


def ensure_built(root: Path) -> None:
    """Build the repository's own host/client bundles before installing.

    `lib/` is generated locally and never versioned, so `install.py` always
    runs the package's own build instead of trusting whatever files happen to
    exist. `npm ci` runs when the toolchain is missing or package-lock.json is
    newer than the installed lock; a machine without npm reports an actionable
    error instead of continuing.
    """
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit(
            "npm is not on PATH - install Node.js/npm, then run "
            "`npm ci && npm run build` inside " + str(root)
        )
    try:
        installed_lock = root / "node_modules" / ".package-lock.json"
        package_lock = root / "package-lock.json"
        toolchain_missing = not (root / "node_modules" / ".bin" / "tsc").exists() or not (root / "node_modules" / ".bin" / "tsdown").exists()
        lock_newer = package_lock.exists() and (not installed_lock.exists() or package_lock.stat().st_mtime > installed_lock.stat().st_mtime)
        if toolchain_missing or lock_newer:
            print("installing the repository's own toolchain (npm ci)...")
            subprocess.run([npm, "ci"], cwd=root, check=True)
        print("building host/client bundles (npm run build)...")
        subprocess.run([npm, "run", "build"], cwd=root, check=True)
    except subprocess.CalledProcessError as error:
        raise SystemExit(
            "dependency install/build failed (npm exit " + str(error.returncode) + ") - "
            "run `npm ci` and `npm run build` inside " + str(root) + " to see the diagnostics"
        ) from error
    required = [root / "lib" / "index.js", root / "lib" / "client.js"]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit(
            "build finished but produced no artifacts: " + ", ".join(missing)
        )


def ensure_preset_runtime_links(root: Path, home: str) -> None:
    """The preset's local .mjs modules resolve bare harness packages from the
    symlinked package's own node_modules (Node realpaths the symlink), so the
    install mirrors the packages already present in the profile module tree
    into the package checkout. Existing workspace links (e.g. the published
    `dsh-llm` used for typechecking) are deliberately left untouched."""
    shared = shared_node_modules(home)
    for name in ("dsh-tools", "dsh-llm"):
        link = root / "node_modules" / "@deepseek-ai" / name
        if link.exists() or link.is_symlink():
            continue
        source = shared / "@deepseek-ai" / name
        if not source.is_symlink():
            raise SystemExit("required harness package link missing: " + str(source))
        ensure_link(link, Path(os.readlink(source)).resolve())
    js_yaml = shared / "js-yaml"
    if js_yaml.is_symlink() and not (root / "node_modules" / "js-yaml").exists():
        ensure_link(root / "node_modules" / "js-yaml", Path(os.readlink(js_yaml)).resolve())


def ensure_lsp_links(home: str, package_root: Path) -> None:
    """The preset mounts the native dsh LSP seam (`dsh-lsp`, `dsh-lsp-stdio`,
    `dsh-tool-lsp`), which is not part of the base bundle. Link the packages
    into the shared profile tree and into the symlinked package's own
    node_modules, because Node resolves the package's real path."""
    root = dsh_install_root(home)
    scope = shared_node_modules(home) / "@deepseek-ai"
    local = package_root / "node_modules" / "@deepseek-ai"
    for name in ("dsh-lsp", "dsh-lsp-stdio", "dsh-tool-lsp"):
        target = root / "packages" / "lsp" / ("lsp" if name == "dsh-lsp" else name.removeprefix("dsh-"))
        if not target.exists():
            print("WARNING: optional dsh LSP package missing from the dsh install; "
                  "opencode-omo will run without LSP:", target)
            continue
        ensure_link(scope / name, target)
        ensure_link(local / name, target)


def check_lsp_servers() -> None:
    """Warn about missing LSP server executables without failing the install.

    The preset disables its `lsp-stdio` row when a server command is absent,
    so the opencode-omo mode stays selectable; this message tells the user how
    to re-enable LSP support.
    """
    missing = [
        (server, command, install_hint)
        for server, (command, install_hint) in LSP_SERVER_COMMANDS.items()
        if shutil.which(command) is None
    ]
    if not missing:
        return
    print("WARNING: LSP server commands are missing from PATH; opencode-omo still installs, "
          "but the preset will run with LSP disabled until they are installed:")
    for server, command, install_hint in missing:
        print(f"  - {server}: {command} (install: {install_hint})")
    print("  Install the commands and restart dsh to enable LSP.")


def install(args: argparse.Namespace) -> None:
    profile = profile_dir(args.home, args.profile)
    ensure_profile(profile)

    # 0. Ensure the shipped host/client bundles exist; bootstrap the npm
    #    toolchain and build when a source-only checkout lacks them.
    root = repo_root()
    ensure_built(root)
    ensure_preset_runtime_links(root, args.home)
    ensure_lsp_links(args.home, root)
    check_lsp_servers()

    # 1. Symlink the package into the profile node_modules (idempotent).
    target = root
    link = node_modules_pkg(profile)
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() or link.exists():
        if link.is_symlink() and Path(os.readlink(link)) == target:
            print("already linked:", link)
        else:
            raise SystemExit("refusing to overwrite existing path: " + str(link))
    else:
        link.symlink_to(target, target_is_directory=True)
        print("linked:", link, "->", target)

    # 2. Add the dependency + bundle entry to the profile manifest.
    manifest_path = profile / "package.json"
    data = read_json(manifest_path)
    deps = data.setdefault("dependencies", {})
    if PACKAGE not in deps:
        deps[PACKAGE] = "link:" + str(target)
        print("added dependency:", PACKAGE)
    else:
        print("dependency already present:", PACKAGE)

    dsh = data.setdefault("dsh", {})
    prof = dsh.setdefault("profile", {})
    bundles = prof.setdefault("bundles", [])
    if PACKAGE not in bundles:
        bundles.append(PACKAGE)
        print("added bundle:", PACKAGE)
    else:
        print("bundle already present:", PACKAGE)

    write_json(manifest_path, data)
    print("installed into profile", repr(args.profile), "at", profile)


def uninstall(args: argparse.Namespace) -> None:
    profile = profile_dir(args.home, args.profile)
    manifest_path = profile / "package.json"

    link = node_modules_pkg(profile)
    if link.is_symlink():
        link.unlink()
        print("removed link:", link)
    elif link.exists():
        print("skipping non-symlink path:", link)
    else:
        print("no link present:", link)

    preset = user_preset_dir(args.home) / "opencode-omo"
    source = (repo_root() / "presets" / "opencode-omo").resolve()
    if preset.is_dir() and not preset.is_symlink():
        removed = False
        for entry in list(preset.iterdir()):
            if not entry.is_symlink():
                continue
            try:
                owned = Path(os.readlink(entry)).resolve() == source or source in Path(os.readlink(entry)).resolve().parents
            except OSError:
                owned = False
            if owned:
                entry.unlink()
                removed = True
        try:
            preset.rmdir()
        except OSError:
            pass
        print("removed preset root entries:" if removed else "no owned preset root entries:", preset)
    elif preset.is_symlink():
        print("skipping legacy preset root symlink (remove manually):", preset)
    else:
        print("no preset root directory present:", preset)

    if manifest_path.exists():
        data = read_json(manifest_path)
        deps = data.get("dependencies", {})
        if PACKAGE in deps:
            del deps[PACKAGE]
            print("removed dependency:", PACKAGE)
        bundles = data.get("dsh", {}).get("profile", {}).get("bundles", [])
        if PACKAGE in bundles:
            bundles.remove(PACKAGE)
            print("removed bundle:", PACKAGE)
        write_json(manifest_path, data)

    print("uninstalled from profile", repr(args.profile), "at", profile)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install/uninstall the opencode-omo dsh plugin"
    )
    parser.add_argument("command", choices=["install", "uninstall"])
    parser.add_argument("--profile", default="web", help="dsh profile name (default: web)")
    parser.add_argument(
        "--home",
        default=os.environ.get("DSH_HOME", "~/.dsh"),
        help="dsh home (default: $DSH_HOME or ~/.dsh)",
    )
    args = parser.parse_args()

    if args.command == "install":
        install(args)
    else:
        uninstall(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
