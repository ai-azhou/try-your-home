# 改改你的家 · 使用说明（短版）

一个离线网页工具：在浏览器里看户型结构的叠图和 3D、试拆墙改门窗、试装修，导出改造清单 PDF。不是施工图；承重和拆墙能不能做，以现场和专业人员的结论为准。

## 1. 下载

- GitHub：打开 https://github.com/ai-azhou/try-your-home/blob/main/try-your-home.html ，点右上角「Download raw file」（下载原始文件）。
- GitHub 打不开时用 Gitee 镜像：打开 https://gitee.com/gevoll/try-your-home ，进入 try-your-home.html 的文件页，同样下载原始文件。

只要这一个文件。不用 clone 仓库，不用装 Node。

## 2. 打开

双击下载的 `try-your-home.html`，用 Chrome、Edge、Safari 这类现代浏览器打开。运行时不联网，方案和图片只在你的电脑上。

## 3. 放进方案

三种来源，选一种：

- **网页 Chat 给的方案**（一大段以 `{` 开头的代码）：点首页的「粘贴方案」（已经打开过方案的，在顶栏菜单里），整段贴进去，点「载入方案」。
- **Agent 给的方案文件**（如 `方案.json`）：在首页点「方案文件」选它，或者直接把文件拖进窗口。
- **还没有方案**：先看第 7 节。也可以点「打开示例方案」先试试。

## 4. 放上户型图当底图

- 方案里已经带着底图（Agent 交付的方案一般带着），会直接显示。
- 提示「底图没找到」（打开的文件）或「方案里引用了底图……」（粘贴的方案）时，点提示里的「重新导入」或「导入户型图」，选同一张户型图，会沿用方案里的比例和位置。之后再粘贴新方案，工具会保留已经放上的底图。
- 没有底图时，在「底图」里点「导入户型图」。
- 叠图整体错开：打开「底图」，用「两点定比例」点一条已知长度的两端、输入真实长度，再拖动底图对齐。这不改结构。

## 5. 看、改、试

- **看 3D**：切到 3D，用「斜视」「俯视」「平视」转着看。
- **核对**：「待核对」里是读图时没把握的问题，可以直接答。
- **试改造**：顶部切到「改造」，选中墙或门窗，拆、挪、加；「对比」看前后差别。承重墙、外墙的改动工具会提醒你先确认。
- **试装修**：切到「装修」，选风格和墙地顶材料，摆家具和柜子（这部分还在迭代，材料和尺寸只是预览和粗估）。

## 6. 导出

点顶栏「导出」：

- **改造清单 PDF**：图文对照，拿去和家人、设计师当面聊。
- **方案文件 JSON**：存档、换台电脑接着改、交给 Agent。文件名是方案标题加 `.json`，在浏览器的下载文件夹里。
- **图片 PNG**：当前 3D 视角。要拿去生成效果示意图，用 3D 左侧工具栏的「导出图片」：先点「白模」，背景选「纯白」、画幅选「16:9」，点「导出 PNG」。

另外两个按钮给 Chat 和 Agent 用：

- 「交给 Agent」：选中墙或门窗，写一句想怎么改，复制出一段交接文字，贴给你的 Agent 或网页 Chat。
- 「复制问题给 Chat」「复制方案给 Chat」（顶栏菜单里）：把校验结果和没答的问题、或者不带底图编码的整份方案复制出来，贴回网页 Chat。

浏览器会自动保存在本机，但换浏览器、清缓存就没了；重要的方案请导出 JSON 留档。

## 7. 还没有方案？

让 AI 先把户型图读成方案：

- **有能跑程序的 Agent**（Claude Code、Codex 等）：装 see-your-home Skill，https://github.com/ai-azhou/see-your-home 。
- **只有网页 Chat**（含手机 App）：用 see-your-home 仓库 `chat/` 里的提示词，说明在 https://github.com/ai-azhou/see-your-home/blob/main/chat/guide.md 。Chat 能联网时，上传户型图再发一句：「请先读取 https://raw.githubusercontent.com/ai-azhou/see-your-home/main/chat/read-prompt.md ，按里面的说明处理我上传的户型图；打不开就读 https://raw.giteeusercontent.com/gevoll/see-your-home/raw/main/chat/read-prompt.md 」。
- 也可以在工具里导入户型图当底图，自己描墙。

## 8. 和 Agent 实时同步（可选，要 Node）

想让 Agent 改文件、页面自动刷新，用本地服务模式。要装 Node（实测 Node 24），在终端运行：

```sh
git clone https://github.com/ai-azhou/try-your-home.git
cd try-your-home
npm ci
npm run build
node scripts/serve.mjs <方案所在目录> [端口]
```

第一个参数是放方案 JSON 的**文件夹**，不是文件；端口可省，默认 5180。终端会列出可以打开的地址，比如 `http://127.0.0.1:5180/?plan=方案.json`。在页面上按 ⌘S / Ctrl+S 或点「保存」写回文件。不用了在那个终端按 Ctrl+C。也可以让你的 Agent 照仓库里的 [AGENTS.md](../AGENTS.md) 帮你弄好。
