# Installation

This plugin ships in two forms. **Most users just want the persistent agent preset**; use the dynamic Cordis plugin when you also want the browser status light.

[简体中文](../INSTALL.md)

---

## Prerequisites

- A working **DeepSeek Harness (DSH)**.
- The **`agy` CLI** installed and on `PATH`:

  ```bash
  agy --version   # verified during development: v1.1.22
  ```

- These host services mounted in the session composition (the `standard` preset has them all):
  `tools`, `subprocess`, `systemPrompt`, `timer`; optional enhancements:
  `jobs` (background jobs), `planMode` (auto plan detection), `sandboxPolicy` (default cwd), `userQuestions` (fallback dialog).

---

## Option A: persistent agent preset (recommended)

### 1. Find your user preset root

Presets live under:

```
${DSH_HOME:-$HOME/.dsh}/.agent-presets/
```

When `DSH_HOME` is unset it falls back to `$HOME/.dsh`. In this repo's dev environment it is:

```
C:\Users\<you>\AppData\Roaming\DSH Desktop\dsh-home\.agent-presets\
```

> Use DSH's `agentPresets` service (`list()` / `resolve()`) to read each preset's real path at runtime; do not assume it.

### 2. Copy the preset directory

```powershell
# Windows PowerShell
Copy-Item -Recurse .\preset\agy-first "$env:DSH_HOME\.agent-presets\agy-first"
```

```bash
# macOS / Linux
cp -R ./preset/agy-first "${DSH_HOME:-$HOME/.dsh}/.agent-presets/agy-first"
```

After copying, the directory should be:

```
.agent-presets/agy-first/
├─ preset.yml
├─ agent.cordis.yml
└─ agy-first-bridge.mjs
```

### 3. (Optional) check the working-directory default

`agy-first-bridge.mjs` has a fallback constant near the top:

```js
const CWD_FALLBACK = 'C:\\Users\\lcl\\Desktop\\DSH'
```

It is only used when the session provides no `sandboxPolicy.workspaceRoot` and the call passes no explicit `cwd`. Change it to your default working directory if you like (usually unnecessary).

### 4. Validate that it mounts

In a session with Cordis capabilities, run a mount check via `agentPresets.standingKeyFor('agy-first')`; success means the module imported correctly, both tools registered, the prompt section assembled, and no root-realm conflict was triggered.

You can also do a quick syntax self-check:

```bash
node --check ./preset/agy-first/agy-first-bridge.mjs
```

### 5. Use it

Start a new session and select the preset **`Agy-First 执行代理`** (id: `agy-first`). You get everything from `standard`, plus the `agy_run` / `agy_continue` / `agy_status` tools, the agy-first policy, and the rate-limit/network fallback dialog.

> **Important: never edit the shipped `agent-presets` install** that comes with the deployment (it is overwritten on upgrade, and corrupting factory presets such as `cordis` can even disable that mode). Always install under your **user** preset root as a separate subdirectory.

---

## Option B: dynamic Cordis plugin (with the browser status light)

The dynamic form is a process-local plugin that **disappears on restart**, but it adds the live status light in the session header.

1. In a DSH session with Cordis capabilities loaded, define the plugin with `cordis_define`:
   - `code.host` = the full contents of [`dynamic/host.js`](../../dynamic/host.js);
   - `code.client` = the full contents of [`dynamic/client.js`](../../dynamic/client.js).
2. Activate the returned `pluginId` / `packageId` with `cordis_run` (`mode: "run"`).
3. The first time the **client half** runs, the DSH GUI raises a one-time approval (single check authorizes the current package; double check authorizes future versions). Once granted, the light appears at the right of the session header.
4. Use `cordis_stop` to disable temporarily; `cordis_undefine` to remove permanently.

> If approval prompts are disabled in the session, the client half is auto-rejected — use Option A instead (the fallback dialog still works, just without the light).

---

## Uninstall

- **Preset**: delete the `.agent-presets/agy-first/` directory (it disappears from the next roster read).
- **Dynamic plugin**: `cordis_undefine <pluginId>`.
