<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo/try-lockup-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo/try-lockup-light.svg">
  <img src="assets/logo/try-lockup-light.svg" alt="改改你的家 · try-your-home" width="392">
</picture>

# try-your-home

**v0.10.1 preview** — a local browser tool for editing floor-plan structure, comparing renovation ideas, and previewing interior layouts. Interior features are still being developed. [中文完整说明](README.md)

Edit walls, openings, rooms and levels; inspect a 3D model; arrange materials, furniture and cabinetry; export plan JSON, images, models and a renovation PDF. This is **not a construction drawing or a basis for structural or demolition decisions**. Dimensions and material quantities need independent verification.

## How to use

No clone and no Node are needed for normal use: `try-your-home.html` at the repository root is a prebuilt single file. Short guide (Chinese, readable by web chats too): [docs/USAGE.md](docs/USAGE.md); notes for your Agent: [AGENTS.md](AGENTS.md).

1. **Download**: open the [try-your-home.html](try-your-home.html) file page on GitHub and click “Download raw file”. The Gitee mirror (https://gitee.com/gevoll/try-your-home) works the same way. Checksums: [SHA256SUMS](SHA256SUMS).
2. **Double-click** it in a modern WebGL browser. It makes no network requests.
3. **Load a plan**: paste the code a web chat gave you with “粘贴方案 / Paste plan”, or open / drag in a plan JSON from your Agent. Or open the built-in example.
4. **Add the drawing as underlay**: an embedded underlay shows up directly; if it says the underlay is missing, use “重新导入 / Re-import” with the same image; otherwise import it under “底图 / Underlay” and align with two-point scale.
5. **Inspect 3D, try renovations and interiors** (interiors are still in progress).
6. **Export** from the global “导出 / Export” button: renovation PDF, plan JSON, or a PNG of the current 3D view.

Browser autosave is local to that browser; export important plans as JSON backups. Live sync with an Agent (local service mode) needs Node: clone, build, then `node scripts/serve.mjs <plan-directory> [port]` (below).

**No plan yet?** Use the companion [see-your-home](https://github.com/ai-azhou/see-your-home) Skill if you have a code-running Agent, or the web-chat prompts in its [`chat/`](https://github.com/ai-azhou/see-your-home/tree/main/chat) folder ([guide](https://github.com/ai-azhou/see-your-home/blob/main/chat/guide.md)), then open the result here.

To build from source with Node.js 24 and npm:

```sh
git clone https://github.com/ai-azhou/try-your-home.git
cd try-your-home
npm ci
npm run build
npm test
npx tsc --noEmit -p .
```

The project config keeps npm's cache in `.npm-cache/`. The build produces the root HTML, checksum, bundle inventory and generated third-party notices. Runtime assets and license texts are embedded in the HTML.

The standalone file makes zero network requests during operation. Plans and images stay on your machine. Local service mode communicates only with a loopback server:

```sh
node scripts/serve.mjs <plan-directory> [port]
node scripts/serve.mjs fixtures 5180
```

The first argument is a directory containing plan JSON and referenced images, relative to the terminal's working directory or an absolute path. The optional port defaults to `5180`. Build first: the server serves `dist/index.html`. Open `http://127.0.0.1:5180/?plan=example-v2.json`; `plan` is a URL-encoded filename relative to the plan directory. The page checks for file changes about every two seconds. Save writes back to an existing JSON file, with validation and conflict checks. Stop the server with Ctrl+C.

Use the companion [see-your-home Skill](https://github.com/ai-azhou/see-your-home) to read a floor-plan image into a plan, then inspect or edit it here. Since v0.10.0, review questions carry a status (open / waiting for the agent / handled) and the agent’s reply; answer them in the tool and use “Send answers to agent”. Pair with see-your-home v1.2.0 or later; v0.9.x cannot open plans with these fields. The JSON format identifier remains `floorplan-structure`. Select elements and use **Hand to Agent / 交给 Agent** to copy context and your request. Nothing is sent automatically. A local service provides the full file path; standalone mode usually provides only a filename. Any data you subsequently share is subject to your chosen Agent's operation and service.

All eight [Agent manual chapters](docs/agent手册/README.md), plus the camera appendix, are included in Chinese. The interior chapter is still a placeholder; see [the format contract](docs/format.md). Four fictional-example screenshots are in the [Chinese README](README.md); they predate the branding update.

Windows has not been tested. Interior editing and browser/GPU compatibility need further validation; see [ROADMAP](ROADMAP.md). Browser e2e was not rerun for this release preparation.

Source available, free for noncommercial use. Original code: [PolyForm Noncommercial 1.0.0](LICENSE). Documents, examples and images: [CC BY-NC-SA 4.0](LICENSE-docs.md). Commercial use requires separate authorization. Third-party components retain their own licenses: [generated notices](THIRD-PARTY-NOTICES.md). Issues are welcome; external code contributions are not currently accepted.

Author: 你的AI阿舟. Email: azhou.ai@proton.me; WeChat: ai_azhou; Xiaohongshu: @你的AI阿舟 (azhou_ai); Douyin: @你的AI阿舟 (azhou.ai). See [COMMERCIAL.md](COMMERCIAL.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
