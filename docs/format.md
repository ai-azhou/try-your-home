# 户型结构 v3

契约以 `src/core/types.ts` 为准；机器校验见 `schema/plan.schema.json`（2020-12）。文件所有长度（平面、厚度、高度、标高）均为 mm；面积 m²；角度为度。内存仍为平面 mm、高度 m，以下 core 接口段落沿用内存单位。JSON 只使用本地资源，未知旧字段存入 legacy。

## 字段

- `format`：固定 `floorplan-structure`；`version`：固定 `3`。
- `title`：方案名称；`ceiling`：默认层高；`north?`：北向角，上方为 0，顺时针为正。
- `walls[]`：墙；`openings[]`：洞口；`beams[]`：梁；`rooms[]`：房间；`questions[]`：问题；`changes[]`：按序重放的改造。
- `legacy?`：旧 JSON 的完整快照，原路径及未使用字段不丢失；不参与几何和改造重放。
- `meta?`：`planFile?` 本地方案文件路径、`source?` 来源、`createdAt?` / `updatedAt?` 时间。
- 所有构件 `id`：稳定且全方案唯一；`evidence?`：`certainty` 为 seen/inferred/unknown，`basis?` 依据，`pixelBox?` 原图像素框，`confirmed?={by,at?,note?}`。
- 墙 `a,b`：中心线端点；`thickness`：厚度；`kind`：exterior/bearing/partition/glass/half/half-glass。
- 墙 `height?`：顶高，缺省取相邻房间最高层高，再缺省取方案层高；`lowHeight?`：矮墙实体高，文件缺省 1000；`bulge?`：圆弧矢高，缺省 0；`name?`：名称。
- 洞口 `wall`：直墙或弧墙 id；`offset`：从墙 a 端到洞口近端的中心线距离；`width`：沿墙宽度；弧墙两者均按弧长计算。
- 洞口 `kind`：door/sliding/doorway/window/floor-window/bay-window/open-balcony；`sill`：洞底；`head`：洞顶，须大于洞底且不高于墙。
- 洞口 `swing?={hinge,side}`：hinge=start/end，指靠 a/b 端；side=1/-1 指向法向/反法向。
- 洞口 `panes?=[{width,kind}]`：width 为正的相对比例，kind=fixed/casement/sliding；`entry?`：入户门；`name?`：名称。
- 梁 `a,b,width,bottom`：中心线端点、宽度、梁底高；`name?`：名称；顶高取所在房间层高。
- 房间 `name,poly`：名称、依序多边形顶点，不重复末点、不自交、不带内孔；`ceiling?`：层高；`floorOffset?`：相对本层楼面的高差，允许负值（降板），缺省 0；`use?`：用途；`counted?`：是否计面积，缺省 true。
- 底图 `underlay?`：`src` 本地相对路径或内嵌图片 data URL（位图 base64；SVG URL 编码或 base64，可带 charset=utf-8）；`mmPerPx` 比例；`mmPerPxY?` 纵向比例；`origin` 平面原点对应像素。
- 底图 `rotation?`：旋转角；`flipX?,flipY?`：镜像；`opacity`：0–100；`visible`：显隐；`calibrations?=[{p1,p2,length,note?}]`：像素两点和实际 mm 距离。
- 问题 `id,text,category`：标识、原话、original/renovation；`certainty?`：seen/inferred/unknown；`bbox?`：平面毫米框；`targets?`：构件 id 数组；`options?`：字符串选项。
- 问题 `answer?`：用户最近一次答复；`answeredBy?,answeredAt?`：答复人和时间。状态、回复及历史见下节。
- 改造 `id,op,type`：标识、add/remove/update、wall/opening/beam/room/column/shaft/stair/void（S2a 起柱、管道井、楼梯、挑空也能被改造记录指向）；`target?`：remove/update 必填的目标 id。
- 改造 `data?`：add 为完整构件，update 为局部字段，不能改 id；`range?=[from,to]`：只拆墙的一段，沿当前墙 a 端量。
- 改造 `note?`：意图及近似；`group?`：同次操作分组；`by`：user/agent；`status`：pending/confirmed；`at?`：时间。
- 改造 `confirm?={by,at?}`：拆除或开洞承重墙、外墙的用户二次确认；`by` 不可为空。status=confirmed 不能代替它。

## 问题卡状态与回复

问题卡新增三个可选字段：`status?: QuestionStatus`；`reply?: {outcome,text,changed?,by,at}`；`log?: [{role,text,by?,at?,outcome?,changed?}]`。reply 必填 outcome、text、by、at，changed 为构件 id 数组；log 每项必填 role（user/agent）和 text，其余可选，按时间顺序只追加。日期 at / answeredAt 使用 YYYY-MM-DD。未知字段仍报错。

| status | 含义 |
| --- | --- |
| open | 待回答，包括 Agent 追问 |
| answered | 已答，等 Agent 处理 |
| resolved | 已处理 |

| outcome | 使用情形 | 结构与 evidence | 工具里显示 | status |
| --- | --- | --- | --- | --- |
| changed | 答复与读图不一致，已按答复改原始结构 | 修改结构；改到的构件写 confirmed，certainty 按实际 | 已按答复修改 · 改了 N 处 | resolved |
| confirmed | 答复证实现在的读法 | 不改结构；targets 写 confirmed | 已确认，没改 | resolved |
| inferred | 用户也不确定，按最可能的保留 | 不改结构；不写 confirmed，certainty 不升级 | 按推断保留 | resolved |
| noted | 偏好、以后再说等，不涉及结构 | 不改结构与 evidence | 已记下 | resolved |
| ask | 答复不足或有歧义，需要追问 | 不改结构与 evidence | Agent 追问 | open |
| withdrawn | 不用再问了，说明撤回理由 | 视情况处理 | 已撤回 | resolved |

status 缺省按推导：没有非空答复 → open；有答复、没有 reply → answered；有答复且 reply.outcome 为 ask → open；有答复且有其他 reply → resolved。合法显式 status 优先。一致性问题只给 question-status 提醒，不拦载入；`reply.changed` 可引用原始构件及成功改造产生的构件。

用户答复写入 answer / answeredBy / answeredAt，status 变为 answered；有旧 reply 时，先把上一轮用户答复（如有）及 Agent 回复追加进 log，再清掉 reply。没有 reply 时改答复直接覆盖。**Agent 不改 answer***：处理时只写 reply 和 status；除 withdrawn 可从 open 或 answered 撤回，其余 outcome（含 ask）都要求当前为 answered。用户选择「我自己改好了」时可写 outcome=noted、by=业主。

`planStats(plan).questions` 返回全部楼层的 `{open,answered,resolved}`；兼容字段 `unansweredQuestions` 等于 open 数，包含追问卡。

```sh
node scripts/plan.ts questions 方案.json --status answered
node scripts/plan.ts answer 方案.json q-kitchen --text "开放式，没有门" --by 业主 --at 2026-10-30
node scripts/plan.ts resolve 方案.json q-kitchen --outcome changed --reply "已改成门洞，不装门" --changed o-kit-slide
```

questions 输出不含 bbox 或底图编码的 JSON 数组；--status 可省略。answer / resolve 只支持原地修改 v3 文件的指定问题卡，保留其他字段及键序；先校验新文本，再写同目录临时文件、fsync、rename。--by 缺省分别为业主 / Agent，--at 缺省本地日期。成功 stdout 输出该卡的一行 JSON（不带 bbox），退出码 0；错误写 stderr（以「错误：」开头），退出码 1，文件不写入。resolve 的 --changed 为逗号分隔的构件 id，不存在则拒绝。

## 方向与改造

平面 x 向右、y 向下，d=b−a，n=(-dy,dx)/|d|。从左向右的墙，法向指向屏幕下方，正矢高朝下鼓起。洞口可挂直墙或弧墙，offset+width 不超过中心线长度（弧墙用弧长）。three 坐标映射为 `(x/1000, 高度z, y/1000)`。

Agent 保留 base，追加 changes。pending 也用于预览；受保护操作缺 confirm 则返回 needsConfirm、不执行。错误不会中止后续记录。原始或当前为 bearing/exterior 的墙在同次重放中保持保护，不能先改分类绕过确认。部分拆除保留第一剩余段 id，第二段为 `墙id~改造id`；洞口跨拆除区间则移除，否则重挂并换算 offset。

```json
{"id":"c1","op":"add","type":"opening","data":{"id":"door1","wall":"divider","offset":1000,"width":900,"kind":"doorway","sill":0,"head":2100},"by":"agent","status":"pending","note":"两室之间增加900mm门洞"}
```

原始编辑用 `bakeChange`，失败抛中文错误；改造编辑追加 Change 后调用 applyChanges。`addOpening` / `moveOpening` 返回 Change 或 `{error}`，会在可用区间找最近位置；`s` 表示期望近端 offset。`splitWall` 不能穿过洞口。`detectRoom` 遇到开敞区或带内孔区域返回 null（Room 契约没有内环）。

镜像 axis=x/y 分别翻转对应坐标，围绕方案外包框中心；同步改造几何、门开向、矢高、问题框、北向、底图。legacy 原文及 evidence 像素框保留原图坐标；`legacy.__structureMirror` 为可逆镜像的本地往返状态，不供 Agent 编辑。

## 两室示例

以下外轮廓 6000mm×4000mm，中隔墙分成两室；可把上面的 c1 追加到 changes。

```json
{
  "format": "floorplan-structure", "version": 3,
  "title": "两室示例", "ceiling": 2800,
  "walls": [
    {"id":"north","a":[0,0],"b":[6000,0],"thickness":200,"kind":"exterior"},
    {"id":"east","a":[6000,0],"b":[6000,4000],"thickness":200,"kind":"exterior"},
    {"id":"south","a":[0,4000],"b":[6000,4000],"thickness":200,"kind":"exterior"},
    {"id":"west","a":[0,0],"b":[0,4000],"thickness":200,"kind":"exterior"},
    {"id":"divider","a":[3000,100],"b":[3000,3900],"thickness":120,"kind":"partition"}
  ],
  "openings": [], "beams": [],
  "rooms": [
    {"id":"living","name":"客厅","poly":[[100,100],[2940,100],[2940,3900],[100,3900]]},
    {"id":"bed","name":"卧室","poly":[[3060,100],[5900,100],[5900,3900],[3060,3900]]}
  ],
  "questions": [], "changes": []
}
```

## 核心辅助数据与命令

`roomsBesideWall` 返回 `{positive: Room[], negative: Room[]}`；合并墙可能邻接多个房间。`diffPlans` 返回 added/removed/modified，每项含 wall/opening/beam/room 的 id 数组。`snap` 的 endpoints/walls/openings/grid/angles 可设 false 或 `{tolerance}`，默认容差 100mm，gridSize 默认 100mm，方向需 anchor；优先端点、洞口端点、中心线、方向、网格。

`Solid.polygons` 为多多边形 `[多边形[外环,...内环]]`，同高墙体并集；同片相交实体按 wall/sill/lintel/beam/glass 优先分配。首层地板默认 [-0.08,0]m，负 floorOffset 时整体下移；正值抬台 [0,floorOffset]m。多层高度和上层楼板见 C3 说明。`buildFixtures` 返回 door/pane/railing 数据；门开启角默认 60°，可用 doorAngle 指定 0–90°。`mergeByKind` 返回按 kind 键控的几何体，`userData.triangleRanges` 为 `{start,count,ids}`，start/count 单位是三角形；并集片的 ids 是共同来源候选，需结合坐标细选具体墙。

```sh
node scripts/plan.ts convert fixtures/legacy-example.json fixtures/example-v2.json
node scripts/plan.ts validate fixtures/example-v2.json
node scripts/plan.ts apply fixtures/example-v2.json
node scripts/plan.ts stats fixtures/example-v2.json
```

convert 的 report 输出 stderr，方案输出指定文件或 /dev/stdout；apply 仅打印重放结果和校验，不覆盖文件；错误退出码 1。JSON Schema 检查字段形状，validatePlan 补充宿主、重叠、自交等跨字段规则。旧转换 report 给出 counts、approximations、unsupported、warnings 和 `idMap[旧id]={wall,offset}`；一个 bay-remove 可扩为同 group 多条 changes。

## 面积统计口径（C2）

`planStats(plan)` 的面积数值单位为 ㎡，最终总和四舍五入到一位小数；显示端可用 `toFixed(1)` 保留末尾零。

- `netArea`：`counted !== false` 的房间多边形面积之和，是墙内净使用面积。房间按数据求和，不自动扣除重叠房间；各房间应正确描绘墙内净边界。
- `area`：兼容旧调用，恒等于 `netArea`。
- `wallArea`：所有墙体完整足迹的并集面积，交接处只计一次，内孔不计。足迹包含门窗跨度，不随窗台或洞顶高度改变；不是立面墙面面积。
- `grossArea`：墙体完整足迹与**全部**房间（含 counted=false）并集后，填掉内部空洞，仅计算各外轮廓面积。保留凹外轮廓，分离部分分别相加，不使用凸包。它也可能包含未绘出的内部空间，不能用 grossArea−wallArea 代替 netArea。

国标里的「套内建筑面积」= 套内使用面积 + 套内墙体面积 + 阳台建筑面积；共有墙（外墙、分户墙）按一半计入。本工具把墙的全厚度纳入外轮廓，未做共有墙分摊或阳台折算，因此 `grossArea` 只是含墙面积的上限估算，不等于合同面积。这些字段是派生统计，不新增方案 JSON 字段，这些派生统计不进入 schema。

## 墙角、分层及编辑（C2）

`wallOutlines(plan, filter?) → Vec2[][][]` 从 `core/walls.ts` 导出（`core/solids.ts` 也转导出），用于 2D：按门窗跨度留空，剩余墙段与相邻墙斜接后并集。filter 为 `(wall: Wall) => boolean`，筛选输出墙但保留全屋交接上下文。`wallFootprints` 是不扣门窗跨度的完整足迹，供面积和封闭房间识别使用；`joinedWallFootprint` 返回指定墙中心线区间的足迹，`buildSolids` 与两者共用它。

端点相距不超过 1mm 视为同一接点；直墙按偏移边线交点斜接，弧墙按精确端点切向衔接。派生足迹统一到 0.000001mm 精度，避免多边形库将浮点尾差当作裂缝，原始坐标不变。斜接尖端离接点不超过较厚墙半厚度的 4 倍，超过则改为平切 bevel。共线接续不延长；T 形主墙不延长。只在原始端点加接头，洞口边缘不加。墙高按本墙及本段洞口断点生成，不再按全屋统一分层；实际相交的不同高墙/梁只在重叠体积处分割并去重，未相交部分保留整高。

`moveJoint` 同组更新相连墙端点与附近房间顶点。沿每面相接墙的法向范围为半墙厚加 30mm，角部距离上限为各半墙厚的平方和开方再加 30mm（覆盖两墙内角的对角顶点）；没有墙端点时不移动房间。`updateBeam(id, patch)` 与 updateWall 一样生成局部更新 Change。

镜像反转 add 完整对象及 update 内的 a/b/poly/bulge/swing.side；沿墙 offset/range/hinge 不变。没有显式 swing 的平开门按默认 start/+1 镜像为 start/−1，二次镜像恢复省略状态。仅含 changes 的方案用改造几何外包框确定镜像轴。

重放已保存在 `base.changes` 的记录时，返回视图在 `legacy.__structureReplayFrame` 保留原始镜像外包框。这样即使改造扩大外轮廓、再序列化，镜像与重放仍使用同一轴；这个保留字段不是旧图原文，Agent 不应手改。`legacy.__structureMirror` 继续保留浮点往返及缺省字段信息。

界面镜像只允许原始模式，整体镜像和普通编辑共用完整 Plan 快照历史，原始、改造和对比态均可撤回/重做，结构与 changes 同步恢复。

## 楼层与新增结构（C3）

以下字段由 v2 引入，v3 沿用结构但文件高度统一 mm。单层旧文件无需补字段。

| 字段 | 数据与约定 |
|---|---|
| `levels?: Level[]` | `{id,name,elevation,ceiling?}`；文件 elevation 为楼面绝对标高 mm，数组从低到高严格递增。省略时为 `[{id:'L1',name:'1F',elevation:0}]`；显式数组不可为空。 |
| 墙、梁、房间、问题的 `level?` | 引用楼层 id，省略为 levels 第一层。洞口没有独立 level，始终跟随宿主墙。 |
| `columns?: Column[]` | `{id,level?,center,shape,size,rotation?,kind,name?,evidence?}`。shape=rect/round，size 为 `[宽,深]` mm；round 的两个尺寸必须相等且均为直径。rotation 为度；kind=bearing/decorative。 |
| `shafts?: Shaft[]` | `{id,level?,poly,kind,name?,evidence?}`；kind=flue/pipe/vent/other。管道井、烟道不可拆。 |
| `stairs?: Stair[]` | `{id,level,to,poly,path,width,kind,steps?,name?,evidence?}`；level/to 均必填且不同，to 必须更高。poly 是占地，path 是至少两点的上行中心线，width 为 mm；kind=straight/L/U/spiral；steps 为正整数，省略按每级不大于约 170mm 取整。 |
| `voids?: Void[]` | `{id,level,poly,name?}（不允许 evidence）`；指定该层无楼面的区域；level 必填。仅扣楼面，不隐式删除穿过它的墙或梁。 |
| `levelUnderlays?` | `{[levelId]: Underlay}`；按层底图，缺省回退 underlay；同样只允许本地路径或内嵌图片（含 SVG）。 |

所有 poly 至少三点，不重复终点、不自交、不退化；所有新构件 id 与既有构件、楼层、问题、改造 id 全局唯一。房间 floorOffset 可为负，例如卫生间文件 `-50`；它改变地面，不改变墙顶或梁底的本层相对高度。

`core/levels.ts` 导出：

- `levelsOf(plan): Level[]`：取显式楼层或隐式 L1。
- `levelOf(plan, element): Level`：返回楼层对象；洞口跟宿主。无效引用在这里回退第一层，以便显示，保存前必须用 validatePlan 报错。
- `levelCeiling(plan, levelId): number`：层默认层高，回退 plan.ceiling。
- `onLevel(plan, levelId): Plan`：只读显示视图，过滤墙、洞口、梁、房间、问题及四类新构件，选择分层底图；保留完整 levels 和 changes 元数据，不是可保存的完整方案，也不会深拷贝构件。界面修改仍应针对完整方案。
- `hasLevelData(plan): boolean`：有非空 levels 或任一非空新增构件集合时启用扩展结果。

`buildSolids` 按层独立生成后整体加 elevation，避免上下层接头、梁和层高混用。首层地板厚 0.08m；上层房间地板输出 kind=`slab`，厚 0.12m，墙体投影下也补同厚楼板；楼面范围由房间和墙体足迹定义，不自动补未描出的房间。每层 voids 扣除 floor/slab/platform。负 floorOffset 同时下移楼板顶底，正值继续出 platform。

柱、管道井输出 kind=`column`/`shaft`，底为本层标高，顶为本层标高加 levelCeiling；圆柱用 64 边形。楼梯沿 path 等距分步，在 poly 内裁切，每步顶面逐步升到目标层标高，输出 kind=`stair`；每级为从本层楼面到踏步面的块体。折线/螺旋按输入 path 的折线近似，不自动设计平台、扶手、斜底板或施工构造。

兼容约定：旧单层方案（没有显式 levels 和新构件）保持原 Solid 的字段形状和 kind；扩展方案的每个 Solid 和 Fixture 带 `level`。因此 `Solid.level` 在 TypeScript 中为可选字段；读取时缺省用 `levelsOf(plan)[0].id`。新增实体不会出现在没有相应构件的旧方案中。buildFixtures 的高度也加楼层标高。

`wallOutlines(plan, filter?, levelId?)` 支持第三参按层；第二参直接传楼层字符串也是简写。filter 为函数时保留同层接头上下文。`detectRoom(plan,p,levelId?)` 可按层检测。原 `hitTest` 返回类型不变；新构件用 `geometry.ts` 的 `hitTestExtra(plan,p,tol=0,levelId?)`，优先柱、管井、楼梯、挑空，返回 `{type:ExtraElementType,id}` 或 null。`columnFootprint` 返回旋转矩形或圆柱离散足迹；`planBounds` 包含新构件。

`planStats` 对扩展方案增加 `byLevel:[{id,name,elevation,netArea,grossArea,wallArea,walls,openings,beams,rooms,columns,shafts,stairs,voids}]`，根对象增加 columns/shafts/stairs/voids 数量。根面积由逐层原面积累加后统一舍入，上下层重叠投影各自计入；原 walls/openings/beams/rooms 等计数含义不变。净面积继续按 counted 房间求和，**不自动扣除柱、管井或挑空**，应把净房间范围正确描绘；grossArea 继续填内孔口径，但扣除 counted=false 房间及仅围绕这些房间的墙。旧单层且无排除房间的方案不增加结果字段。

`mirrorPlan` 同时镜像新构件中心、多边形、楼梯 path、柱角度及每层底图。`agentHandoff` 支持旧 ElementRef 和 ExtraElementRef，在描述中带楼层名及 id。

S2a（10-29）起 ElementType 已包含 column/shaft/stair/void，改造记录可以新增 / 修改 / 拆除新构件；拆除承重柱（`kind: bearing`，按原始结构记）和承重墙一样先报 needsConfirm，带 confirm 才执行；管道井拆除一律报 error。（以下为 C3 当时的说明）`edit.ts` 导出 `shaftRemovalError(plan,target): string|undefined` 供下一轮入口接线；applyChanges 也在类型检查前检查 remove 的 target，命中任何管井时一律返回 error「管道井 / 烟道不能拆」，confirm 也不能放行。承重柱的正式改造确认留待 Change 契约扩展。

## 弧墙接口（C3）

`geometry.ts` 新增 `arcParams(w)` 返回 `{radius,angle,sagitta,center}` 或直墙时 null；长度为 mm，angle 为度，带符号并与 bulge 同号（不采用屏幕圆弧 sweep 的相反号）。`bulgeFromRadius(chord,radius,major=false)` 返回正矢高，反侧由调用方取负；radius 必须至少为半弦长。`bulgeFromAngle(chord,angle)` 接受 −360° < angle < 360°，0 返回直墙，整圆无法用非零弦长表达。

`openingSpan` 保留 a/b/center/dir/normal/wall；dir/normal 是洞口弧中点的切向/法向，新增 `path`（弧子路径）、`startTangent/endTangent`、`startNormal/endNormal`。弧上点选和吸附用精确圆弧投影。openingFootprint、wallOutlines 与实体切片沿同一弧长区间，墙端斜接使用圆弧端点精确切向。优弧 90°/180°/270°/340° 及反侧均有测试。

C6 起弧窗、弧推拉门按 panes 的扇数返回 Fixture，曲线细分不再增加窗扇或竖框；width 为该扇中心线弧长。弧平开门支持弧形门扇，整扇绕铰点旋转。弧形 Fixture 新增 path / footprint / paneIndex，不能拿旧 center / dir / width 再画一块直板。直墙 Fixture 字段和数值保持不变；未封阳台栏杆仍按两端弦近似。详见下方 C6 接口。

`updateWall(id,patch)` 仍返回一个 Change。patch 含 bulge 时，applyChanges 保持可容纳的弧长 offset，超出新长度的洞口从末端向前夹回，避免夹回后互相重叠，返回 `ChangeResult.warnings?:string[]` 和受影响洞口 ids。单洞比整墙更宽时缩至墙长；多个洞口总宽超过墙长时无法同时保留，整条更新回滚并报错。未改 bulge 的端点缩短仍沿用原校验与回滚行为。addOpening/moveOpening 支持弧墙，保护墙确认规则继续生效。

## 测距接口（C3）

从 `core/measure.ts` 导入 `measureWalls(plan,idA,idB)`。返回毫米单位的 `{dx?,dy?,normal?,nearest?,intersect,centerline?,segments}`。

- 轴对齐墙：足迹包围框的 X/Y 净距，投影重叠方向不输出值。
- 平行斜墙且有限长度的切向投影重叠：只出 normal，标注线严格沿法向。
- 其他斜墙、弧墙、平行但切向分离的有限墙：nearest 及其绝对 dx/dy 分量；弧墙按既有离散足迹近似。
- 足迹相交、相接或包含：`{intersect:true,segments:[]}`，不输出距离数字。
- centerline 是具有对应 dx/dy/normal/nearest 键的对象，用于附注。缺失墙 id 抛中文错误；请先传入当前楼层视图。
- 每条 segment 为 `{kind,a,b,extensions:[{a,b}]}`；a/b 是尺寸线端点，extensions 从实际墙面延至尺寸线，画虚线。长度重叠时取重叠段中点，无重叠时取两最近投影边的中间位置并补延长线。

## 改造清单取景与分页（C3）

从 `core/pagination.ts` 导入 `changeFocus`、`paginate` 及 Focus/Page/PaginationOptions 类型。

`changeFocus(base,changes)` 不执行改造，也不替用户确认：它在私有几何时间线上定位提案，包括待确认的保护墙拆除、新增后再次修改、局部拆墙后的剩余段。同 group 合为一个 Focus；changeId 为组内按字典序最小的 id，changeIds 保留完整映射。

Focus 为 `{changeId,changeIds,group?,anchor,bbox,level,view,reason,wall?,room?,overview}`。anchor 是构件上的平面毫米点；bbox 含更新前后范围；overview 为整层外包框。拆加墙、开封洞、房间边界用 plan；洞底/洞顶/类型修改、玻璃/矮墙、梁用 elevation；房间层高/高差、楼梯用 3d。组内视图优先 3d > elevation > plan，锚点取该视图的代表构件，reason 合并理由。跨层 group 仍是一条，以代表构件楼层为准，建议 UI 生成 group 时限定同层。

梁没有宿主墙字段，梁立面用 `wall=梁id` 标识独立立面，UI 需先查墙再查梁。楼梯 3D 的 `room=楼梯id` 同理。正式 Change 暂不允许新构件，分页模块提供仅用于预览的 `FocusChange` 扩展，能给未来楼梯等提案计算关注框，不修改 Plan.changes 的存储契约。

`paginate(focuses,opts)` 返回 `{view,level,frame:Box,wall?,room?,items:[{changeId,number,anchor}]}` 的 Page 数组。opts：

| 参数 | 含义与默认 |
|---|---|
| aspectRatio | 可画图区域宽/高，默认 277/190 |
| pageWidthMm | 可画图区域实际纸面宽度 mm，默认 277；须扣除留给文字的宽度 |
| minNumberSpacing | 纸面序号中心间最小欧氏距离 mm，默认 10 |
| maxItems | 每页最大条数，默认 8，正整数 |
| margin | 取景框四周的模型空间边距 mm，默认 200 |

先按楼层试 plan 总览；放不下时改用条目 bbox 并集，再沿锚点分布较长轴递归聚类拆页；每页扩为目标宽高比并检查纸面间距。完全同点的不同条目最终分到不同页，不移动构件锚点。elevation/3d 按楼层与墙/房间分别成页，仍受每页上限及序号间距约束。每条分组改造恰好出现一次：成功的一页总览同时作为该组明细，不额外复制概览页。

全局编号在分页前按 anchor 的 y、x（从上到下、从左到右），再按 level/id 稳定排序；换纸幅、页数上限或输入顺序不改编号。frame/anchor 始终是模型平面坐标；elevation/3d 渲染器须用 wall/room 确定镜头，若在图上重新投影标签，应基于最终投影另行检查纸面间距。这里交付纯几何分页，不包含 PDF 排版和文字空白区布局。

## Schema 再生成

运行 `node scripts/plan.ts schema`（或 `node schema/generate.ts`）更新 `schema/plan.schema.json`，schema 同步楼层引用字段、新构件、负 floorOffset 和分层底图。JSON Schema 管字段形状，validatePlan 管层引用、递增标高、多边形自交等跨字段规则。`scripts/create-schema.ts` 是 C1 的旧生成器，本轮不在允许修改范围内；请改用上述新入口，避免把 schema 回退到旧格式。

## 装修层 v0（C4，2026-10-29）

本节列出的装修对象与函数使用内存单位（高度 m）；写入 v3 文件时所有高度乘 1000 为 mm。存储入口为 `Plan.decor?: Decor`，`Decor` 与 `DecorLayer` 同义，定义在 `src/core/decor/types.ts`。未开始装修可完全省略；存在时必须有 `version:1`、`style`、`materials`、`surfaces`、`furniture`、`cabinets`、`panels`、`recesses`。可选 `presets` 保存自定义风格，`cache` 保存最后有效的平面外包框和墙面线。装修直接存当前状态，不写进结构 `changes`。

- 装修项 `id/by/status` 必填，`by=user|agent`，`status=pending|confirmed`。装修项、材料、自定义风格的 id 与结构 id 共用唯一命名空间。`newId` 会避开装修 id。
- 材料 `id/name/category/color`；color 为 sRGB `#RGB` / `#RRGGBB`。纹理采用草案枚举；PBR 系数为 0–1，贴图仅允许本地相对路径。`createDecor(style)` 复制内置材料到方案，六套材料板对应样张 02：`cream/wabi/minimal/mid/nordic/zh`。
- `FaceRef={wall,side:1|-1}`，`FaceSpan={face,s:[s0,s1],z:[z0,z1]}`。`s` 为从墙 a 端沿中心线量的 mm，`z` 为本层楼面的 m；`side=1` 的立面 `u=s`，`side=-1` 的立面 `u=L-s`。跨墙 s 可越出锚墙，但只能沿首尾连续且墙面共面的直墙链；反向记录会同时换算 side。弧墙只允许整面材质，展开按真实面弧长缩放。
- 柜体 `place={face,s,gap?}|{at,rot}`；沿墙柜占 `[s,s+width]`，反侧柜子的立面左端在 `s+width`。岛台 `at` 是中心。柜宽/深/台面厚度 mm，`z`、格高 `h`、踢脚高 m。只允许末列省略 width、最上格省略 h；其余尺寸不自动按比例改。`layoutCabinet` 给出 columns/cells/parts/cuts/footprint/issues。
- 造型为 feature/wainscot/slats/skirting/arch。普通造型指定 span；arch 指向现有 opening，缺省用 `side=1`，需要反侧时用可选 `span.face`，其 s/z 仍从 opening 派生。格栅独立条、护墙框线、分缝及自动扣门窗均为派生几何。
- `Recess` 墙上为 `kind=niche,host={face},rect={s,z}`，板/柜上为 `kind=hole,host={panel}|{cabinet},rect={u,z}`。局部 u 从宿主立面左端量 mm，z 仍离本层楼面 m。墙上 depth 必须小于墙厚；板柜 depth 可等于宿主厚度或写 through；超厚报 host-depth。家具和柜体的 embed 自动派生墙上凹槽，不重复存 Recess。家具 in 指向宿主项 id 或 cabinetId:cell:列:行（零基）时，派生位置默认在宿主横向居中、正面齐平；缺 z 取宿主下沿，rot 是相对宿主的角度偏移。in 家具禁止保存 at，失去宿主后使用 decor.cache 的最后有效 pose。
- 墙上嵌入两侧同时重叠且深度和达到墙厚时返回 meet-other-side；门窗冲突、玻璃/矮墙实体范围、管井、可见范围等也检查。承重墙、外墙、承重柱只给 protected 警告，包含证据确定度及现场专业确认说明，ack 不解除事实。`checkEmbed(after,decor,item,before?)`、`validateDecor(after,decor?,before?)` 的最后参数用于保留原始保护类型。

统一入口 `src/core/decor/index.ts`，也可从对应模块导入。几何函数接收已经应用结构改造的 Plan；不要把待确认提案当作实际宿主。`resolveDecor(before,after)` 返回派生 decor、带 placed/moved/missing 状态的 items/placed，以及 issues；另支持 `resolveDecor(after,decor?)`。函数不改输入。需要重新挂接时传入修改前的已应用结构和修改后的结构；写回时使用 rehostDecor(before,after,decor)，它维护用于重复解析与撤销的 cache.anchor，不能只手改墙 id。部分拆墙时同洞口规则换算到剩余段；跨断口报 host-cut，缩短超范围报 out-of-face，缺宿主保留原位置或 cache 幽灵。

`elevationOf(plan,wallId,side)` 给出 outline/openings/beams/adjacentWalls/floorLines/ceilingLines/items；横坐标 u 为 mm，高度为 m，并按房间保留降板和顶面线。`panelGeometry` 的 polygons 是板体轮廓（已扣结构洞口），visiblePolygons 再扣装修洞口供立面使用，grooves 在洞口处断开。`cabinetTransform`、`panelTransform` 将宿主局部 u/出墙深度换成平面 mm。

`resolveSurfaces` 返回 floors/walls/ceilings/all；每块带 material/materialId、overridden、surface、polygons 和 m² 面积。覆盖按数组末条优先，区间重叠只计一次；跨链部分覆盖会投射到后续墙段。墙片 polygons 的坐标为中心线 s(mm)/z(m)，不是 u；地面 polygons 为平面 mm/mm。`materialTakeoff` 按材料给出 floor/wall/ceiling/panel/cabinet/countertop/area，均为 m²、approximate=true：地面按房间净多边形，墙面两侧分别计且扣门窗及被板遮住的区域，穿板洞露出原墙面。柜体为正立面投影面材和水平台面，不是板材开料量；家具软包和五金等不推测用量。

`furnitureFootprint` 给旋转占地；`furnitureCollisions` 检查同层墙及其他家具（家具间另看高度），不改变摆放。可完整容纳家具的门窗洞口不当墙。`furnitureClearances` / `measureFurniture` 返回到墙和家具的最近数据、dx/dy 和四向 directions；无对象的方向省略，不输出 Infinity。方向净距使用实际多边形扫描线；斜墙最近距离沿离散足迹计算。

白模 `buildDecorSolids(plan)` 返回 `DecorSolid[]`，几何字段与结构 Solid 相同，kind 均为 `decor-*`，附材料 id；高度为绝对标高。出现有效嵌入时仅返回受影响墙的带 `replaces` 的墙/窗台/过梁/玻璃替换实体；结果数组的 hideWallIds 列出要隐藏的结构墙 id，保留其余墙，不能全屋隐藏或重复叠加。另有 `decorWallSolids(plan,decor?)` 返回完整结构场景（原 kind），只在墙体实体上真实扣凹槽。两种入口不要重复叠加。原 `buildSolids` 完全不读取装修层。

`mirrorPlan` 会镜像家具、自由柜、墙侧、柜列/铰链、局部洞口、铺法和 cache；已有的 `legacy.__structureMirror` 往返状态保存装修的省略字段和浮点数，两次镜像（含保存重读）深相等。单独 `mirrorDecor` 是派生转换，会将省略的列宽补成实际数值；需要精确恢复数据形状请用 `mirrorPlan`。

`parsePlanText` 保留 v2 装修数据；旧格式导入额外调用 `fromLegacyFurniture`（根 `legacy.furniture` 优先，兼容 legacy.layout.furniture），已识别类型映射、未知类型占位、颜色转材料、wallColor 转自定义风格，原 legacy 不改。`agentHandoff` 接受 furniture/cabinet/panel/recess/surface/decor 引用及 decor 模式；`planStats` 仅在存在装修层时增加 decor 统计。`validatePlan` 追加 decor-* 问题，不改变结构校验逻辑。

```sh
node scripts/plan.ts decor <方案.json>  # 输出重挂结果、问题与材料粗估，不修改文件
node scripts/plan.ts schema          # 从装修 TS 类型生成 shape，再加尺寸/本地路径约束
```

装修 schema 定义由 `schema/decor.ts` 读类型生成，避免另维护一份漂移的嵌套字段；几何区间、宿主链、楼层、材料引用和全局 id 唯一性由 validateDecor 检查。结构类型、ElementType、Change 和原 SolidKind 均不扩装修值。

## 装修层第二轮（C5）

- Furniture 为互斥联合：自由家具 `{at:[x,y],rot,...}`；宿主家具 `{in:string,rot?,z?,...}`，不得同时有 at/in。读取旧 JSON 时 `parsePlanText` 仅删除同时存在的 at 并记入转换报告；直接新写入同时存在则报 `invalid`。不改 version，不修改 legacy 原文。
- `furniturePose(plan,f)` 返回 at/center（世界平面 mm）、rot（度）、z（本层相对 m）、footprint（旋转矩形 mm）、level、missing。宿主可为柜体、柜格、造型、壁龛、板/柜洞。in 时 rot 是相对宿主的旋转偏移；不存放偏移量。平面、立面、3D、碰撞和净距使用同一 pose。旧单参 `furnitureFootprint(f)` 仅适用自由家具，宿主家具需第二参数 plan。
- `rehostDecor(before,after,decor):Decor` 返回可存储的新层；完全落在剩余段内的构件改用派生 id 和局部 s，并维护 cache。重复调用幂等；撤销后可由派生段回到原墙，拆头后原 id 不变的情形也还原 s。cache 每项新增可选 `anchor:{wall,a,b}`（所挂墙的世界中心线，用于存储坐标追溯）与 `pose:{at,rot,z}`（家具最后有效姿态）。不挂得上的项保留数据及最后位置。
- `decorStatus(basePlan)` 只重放 confirmed 结构改造，返回与 resolveDecor 同形的 decor/items/placed/issues；已重放视图不重复应用。每项含 status、text、reasons、footprint、level、item。界面「没地方挂」只判断这里的 status；validateDecor 使用同一解析结果，按 id/code 去重。
- `buildDecorSolids` 仍返回数组，新增属性 `hideWallIds:string[]`。调用方只隐藏这些 id 的 wall/sill/lintel/glass，再加入装修实体；替换实体保留 ids（包含原洞口分组）、wallKind、level 和 replaces。JSON 序列化数组不会带自定义属性，跨进程请显式封装 `{solids,hideWallIds:solids.hideWallIds}`。
- `sectionAt(solids,z)` 使用绝对标高 m，只保留 z0 < z < z1，返回 kind/ids/material?/polygons/z/level?/wallKind?；polygons 保留孔环。先过滤原墙，再把结构实体和装修实体一并传入。首层常用 z=1.1，其他楼层为楼层标高+1.1。
- `elevationOf(plan,wallId,side,base?)` 的 base 用于显示已拆墙原位。除原有 fields，增加 ax/H、wallKind/thickness、segments、focus、ends、removed、panels/cabinets/niches/furniture、skirting。beams.kind 为 cross/parallel，并带 bottom/name；仍保留 u/z/polygons。全部 u 为面对墙面从左到右 mm，z 为本层 m；s 转 u 必须经过 axis.toU，反侧不能直接拿 s。
- `layoutCabinet` 的 cells.pieces 为被跨格 cuts 裁后的格矩形；parts 中每块门板/抽屉面增加 pieces 与 polygons，包含 3mm 门缝及跨格裁切。界面绘制 front 的 polygons，可用 column/row 回查格子与拉手，不能再画原始整块外包框。
- `resolveFinish` 补 styleMaterial、surfaceItem，保留 surface=id；支持 opts.styleId/keep 预览。整面墙查询默认取贴墙最长的房间，平台 floorOffset 使用 stone.top，与原界面一致。`resolveSurfaces`、`materialTakeoff` 也支持 styleId/keep 预览；材料表补 where、overridden、count（该材料柜门对应柜体数），面积仍按真实覆盖/裁切计算。
- `decorHandoff(plan, refs)` 同时接受单个 DecorRef 和装修 id 字符串数组。CLI decor 额外输出 rehosted 供审阅，不自动写文件。
- `planStats` 的 netArea/grossArea 排除 counted=false；仅邻接这些房间的墙不入 gross，兼有计入房间的共用墙保留。填内孔后再扣排除多边形，避免被围合露台误加回来。excludedRooms=[{id,name,area}] 与 excludedArea 单列，byLevel 同口径；跨层独立计算。wallArea 保持结构墙投影总量，不改变原含义。旧单层无排除房间时省略 excluded 字段以保持对象形状兼容；扩展楼层方案逐层总是给出它们。

C5 问题码沿用既有枚举，不引入新 code：同时存 at/in、缺两者、非法旋转/cache 为 invalid；宿主链/柜格消失为 host-missing；跨拆段为 host-cut；高度或面范围越界为 out-of-face；派生墙 id 已正确重挂则不再报 host-missing。missing 状态包含 host-missing/host-cut/out-of-face/arc-unsupported/room-missing，其中 room-missing 仍是 info。protected、through-wall 等其他诊断继续沿用 C4 规则。

## v3 文件边界与升级（O2）

`serializePlan` 一律写 version=3；`parsePlanText` 读 v3 时将高度还原为内存 m，读 v2/legacy 时沿用旧单位。内存 version 维持 2，表示运行时契约，不能直接 JSON.stringify 内存方案。导入、导出、本地自动保存、服务读取/写回和 CLI 共用此边界。旧 localStorage key 保留，以便自动读取 v2；新内容为 v3。

换算路径见 `io.ts` 的 METRE_PATHS：plan.ceiling；walls.height/lowHeight；openings.sill/head；beams.bottom；rooms.ceiling/floorOffset；levels.elevation/ceiling；decor.furniture.height/z；cabinets.z/plinth、columns.cells.h、cells.void.top.z、cells.appliance.size[2]、cuts.z；panels.span.z；recesses.rect.z/shelves；surfaces.target.z；presets.trims.skirting.height；cache.pose.z。changes.data 按 type 转换对应的构件字段。楼梯没有独立高度字段，由 levels.elevation 之差派生。

装修类型与以上 core 函数仍使用内存单位；文件中的柜格 h、踢脚高、台面离地、家具高及家电 size[2] 全为 mm，装修 version 仍为 1。柜台 top.thickness/overhang、槽深、平面坐标原本就是 mm。问题卡 bbox 原本为 mm；text/options/answer 中明确写 m/米的长度转写 mm，不猜没有单位的自由文字，不转换 m²。legacy（含镜像精确往返快照）原样保留，不是 v3 可编辑构件。

Agent 交接与 CLI stats/validate/decor 输出统一长度 mm；面积仍为 m²。GLB 遵循 glTF 米制，软件渲染内部米制不受文件 v3 影响。

## 软件相机与素材（O2）

`raster.ts` 的 listCameras / resolveCamera / renderKit 供 CLI 共用。相机输入与 camera JSON 均为 mm、Y-up；renderKit 返回同一机位的 PNG 字节映射与相机记录。`--camera` 接受五种预设、room:id[:wallid]、pos=…;target=…;fov=… 或相机 JSON。`--level` 按层、`--state` 原始/已确认改造、`--section` 相对楼面 mm。平视为 1450 mm/75°，补天花。通道 clay/depth/lines/seg/openings，16 位线性深度和实例编号均用灰度 PNG；文件细节见发布 Skill references/相机与素材通道.md。

## C6 连续墙面、弧门窗与机位（派生接口）

本节不新增方案字段，不改 v3、schema 或 `src/core/types.ts`。接口接收已应用改造的内存 Plan；没有新依赖。

### 墙面皮与立面

```ts
import { wallSkins, elevationOf } from './src/core/decor/index.ts'
const skins = wallSkins(plan, { styleId: 'cream', keep: true, offset: 1.5 })
const faceSkins = wallSkins(plan, { face: { wall: 'w', side: -1 } })
const elevation = elevationOf(plan, 'w', -1, basePlan, { styleId: 'cream', keep: true })
// elevation.surfaces 可直接用于立面，不再自行把 resolveSurfaces 的 s 换算成 u。
```

`wallSkins(plan, opts={}) → WallSkin[]` 从 decor/index 或 decor/wall-skins 导出。选项：`face?` 只取这面及其共面直墙链，`level?` 按楼层过滤，`styleId?/keep?` 与 resolveSurfaces 一致；`maxSegment?` 弧面展开分段上限，默认 150 mm；`offset?` 沿墙面外法向偏移 mm，默认 0，保留结构墙同时贴色时可传 1.5 防止深度冲突。材质预览不改变输入。

每片字段：

- `wall/side/face` 是展开锚墙；指定 opts.face 时就是指定的墙面，否则按墙 id 稳定排序选锚墙。`wallIds` 和 `faces=[{wall,side}]` 列出实际贡献墙段，反向记录会换算 side。
- `room?` 是该片房间 id；不贴房间的外侧不虚构房间。`level` 始终有值。跨两个房间即使同材料也分开，便于按房间标注。
- `material/materialId`、`overridden`、`surfaceIds` 是合并后的材料与来源；相同房间、相同材料合并为一个对象，即使部分来自显式覆盖，`overridden` 只表示其中存在覆盖。
- `polygons` 为多多边形 `[多边形[外环,...孔环]]`，坐标 `[u毫米,z米]`。u 是锚墙 faceAxis 的展开坐标，共线链可能超出 `[0,L]`，反侧已翻向；z 相对本层楼面。`area` 为该皮面积 m²。
- `positions/normals` 是非索引三角网格，可直接交给 BufferGeometry；每 9 个 positions 数字为一个三角形。世界坐标为 **Y-up 米** `[平面x/1000,楼层标高+z,平面y/1000]`，normals 为朝该侧的单位向量。这与 core/mesh 相同，不是 v3 文件坐标。

墙面皮先按 resolveSurfaces 解析材料，再跨共线墙段并集；门洞是轮廓缺口，窗洞是孔，不沿 sill / lintel / wall 实体分界生成材料接缝。弧墙同材料是一张网格，所有材料共享分段边界。有效嵌入按 checkEmbed 与替换墙的同一口径**扣掉**凹槽区域，保留 buildDecorSolids / decorWallSolids 的凹槽内壁；墙面皮本身不另外给凹槽背板上色。无效、穿墙、弧墙嵌入不扣。跨链凹槽也会替换所有受影响墙段。

`elevationOf(plan,wallId,side,base?,opts?)` 新增 `surfaces:WallSkin[]`；polygons 已在当前立面 u/z 中，key/material/overridden 可直接绘制。`u/width/focus/ends` 采用各段 faceExtent 的实际可见范围；两端剖块只保留在可见范围两端的墙，同层判定先于命中。

### 弧门窗

```ts
import { buildFixtures, openingSymbol } from './src/core/solids.ts'
const fixtures = buildFixtures(plan, { doorAngle: 60 })
const symbol = openingSymbol(plan, 'opening-id', { doorAngle: 60 })
```

`openingSymbol` 也可从 core/opening-symbol 导入，返回：`id/wall/curved`；沿洞口的 `path`；墙厚两侧 `edges:[path,path]`；洞口两端 `jambs` 和仅扇间交界的 `divisions`（各为平面线段）；`leaves=[{index,kind,s,path,footprint,hinge?}]`。所有坐标、s 均为平面 mm，path 的细分顶点**不是**竖框。直墙 path 只有两个端点。缺洞口或缺墙抛中文错误。

弧墙的每个 Fixture 对应一扇，新增 `paneIndex/path/footprint`；footprint 是完整曲面板材的平面占地轮廓，配合 z0/z1（或 door 的 z0+height）挤出即可。弧长分扇按 panes.width 比例；滑门缺 panes 时默认两扇，窗缺 panes 时一扇。弧平开门缺 panes 时一扇，有 panes 时按比例分扇，默认末扇铰点在 end，其余在 start；显式 swing 覆盖默认。整条 path 和 footprint 绕铰点旋转，不退化成弦板。三维高度是绝对标高 m，path 坐标仍 mm。

core/mesh `buildMesh` 已消费 footprint：弧玻璃/门扇每扇一块连续几何；框只有 jamb/divisions 的竖框及沿弧上下横框，细分中间不补竖框。框宽 30 mm、深 40 mm；平开门省略底横框。界面和其他导出消费者需接 path/footprint 或这些 mesh，旧的 center/dir 直盒画法不会自动变弯。直墙 buildFixtures 与 buildMesh 保持旧结果；开放阳台栏杆本轮仍沿弦。

### 材料地点、关注房间、交接

`materialTakeoff.where` 墙面为「房间名 + 方位 + 墙」，地面/顶面为「房间名 + 地面/顶面」。方位由房间指向墙，按 north 旋转，取最近的北东南西；没有 north 则用上右下左。没有相邻房间时用墙名或 id、侧与方向，不再输出独立的「墙面」。柜体/造型/凹槽用途附具体位置与构件名或 id。面积计算口径不变。

`decorFocus(plan)` 的每项增加 `room?:string`：优先实际墙面跨度中心所在房间，板/柜洞及宿主家具跟随宿主，其他按真实占地中心与楼层定位。无法确定时留空，不用最长邻房猜；单项跨两间房取中心所在房间。保留原行为：自由家具不进 Focus 编号列表。可直接用 `decorRoom(plan,item)` 查询其房间。

`decorHandoff(plan,ids[])` 按实际类型输出柜体、造型、壁龛 / 挖洞、家具、材料覆盖；不存在的 id 仍明确报告。

### cameras

`listCameras(plan,state='original',opts={all?:boolean,level?:string})` 默认每层五个预设 + 每间可站人房间的默认平视；`all:true` 才计算朝各面墙的变体，level 在计算前过滤。搜索先用 48×32 筛选候选，再以原 96×64 探针复评前六名的三个俯仰角；栅格化只对跨越近远平面的三角形执行裁切，减少临时数组。不为 counted=false、面积 <1.5 m²、floorOffset >0.3m 的房间生成平视；直接 resolveCamera 的 room:id 也拒绝这些房间，自定义相机仍可用。符合上述条件的开敞阳台保留，说明带「开敞阳台，平视多半是天空」。

```sh
node scripts/plan.ts cameras fixtures/example-v2.json
node scripts/plan.ts cameras fixtures/example-v2.json --all --level L1
```

## 简版格式（工具的导入格式，Skill 不用）

**Agent / Skill 一律输出完整 v3，不要输出简版；简版只给网页 Chat 用，提示词在 see-your-home 的 chat/read-prompt.md**

简版是单层、毫米制的导入格式，不是完整方案的另一种保存格式。`src/core/simple.ts` 提供模板、规则、识别、转换和复制给 Chat 的纠错文字；工具导入后仍用原来的内存 Plan（version 2，平面 mm、高度 m），`serializePlan` 保存成完整 v3。

### 字段与标准形状

| 字段 | 说明 |
| --- | --- |
| `format` / `version` | 固定为 `"floorplan-simple"` / `1` |
| `title?` | 方案名，缺省「简版方案」 |
| `rooms[]` | 非空数组；每项必须有不重复的 `name`，可有 `id` |
| `rooms[].rect` | `[左上角 x, 左上角 y, 宽, 深]`，宽、深大于 0 |
| `rooms[].poly` | 顺序顶点 `[[x,y],…]`，至少三点，不重复首点、不退化、不自交；和 rect 二选一 |
| `doors[]` | `{between:[A,B],open?:true}`；A、B 引用房间 name 或 id |

所有长度 mm，x 向右、y 向下。相邻房间共用边的坐标应相同，房间不重叠、不留缝。户外可写「外面」「室外」「户外」或 `outside`，通常写 `{"between":["客餐厅","外面"]}`。`open:true` 表示两间房之间敞开，没有墙和门洞。不要写 walls、windows 或楼层；窗户由用户在工具里补。

规范模板与六条规则分别以 `SIMPLE_TEMPLATE`、`SIMPLE_RULES` 为准；`simpleFormatChatText(reasons)` 返回整段可交给 Chat 的提示词。`schema/simple.schema.json` 为 JSON Schema 2020-12，与完整方案 schema 一起由 `node schema/generate.ts`（或 `node scripts/plan.ts schema`）生成。schema 描述标准形状，允许额外字段；以下非标准写法由转换器宽容处理，不扩大标准 schema。

### 宽容与阻断

每种修正均记入 `notes`，通过导入报告的 `approximations` 提供给界面：

- 顶层仅一个键、其对象值带简版 format 时，拆掉这一层。
- `"floorplan-simple":1` 或 `"floorplan-simple":"version 1"` 也能识别；version 缺失或字符串 `"1"` 按 1 读取，其他版本报错。
- 忽略多余字段，键名汇总一次；room 的 id 不是多余字段。poly 的 `{x,y}`、rect 的 `{x,y,w,h}` / `{x,y,width,height}` 转成数组。
- 门的 `{from,to}` 转成 between。重名改成「卧室」「卧室 2」等，原重名引用按第一间房。
- 所有输入坐标及 rect 尺寸绝对值都 ≤100 时，统一乘 1000，同时生成「坐标像是米，已按毫米 ×1000 换算，请核对尺寸」问题卡。

缺少或空 rooms、缺 name、rect 非四个有限数或宽深不正、poly 少于三点、非有限/字符串坐标、自交或退化多边形都会阻断；同时给 rect 和 poly 也阻断。错误使用简版路径和房名，如 `rooms[2]（厨房）.poly：至少要 3 个点`。`simpleToPlan` 返回 `plan:null`；`parsePlanText` 维持现有失败形状，返回 `emptyPlan()` 和 error issues。

### 自动补全规则

1. 顶点以 `SIMPLE_SNAP=150` mm 就近聚类取平均，附近顶点投影到其他房间边上，再按顶点切开边，处理 T 接头。聚类不合并同房间两个顶点，组内两点不跨过容差；会造成自交/退化的吸附撤回并记 note。
2. 两间及以上房间共用的小段生成 partition 隔墙，厚 `DEFAULTS.thickness.partition=120` mm；单间房边生成 exterior 外墙，厚 240 mm。房间边当墙中心线。共线、相连、同类型段合并，保留各段所属房间用于定位门。open 关系的共用边直接移除，不生成墙或洞口。
3. 普通门宽 900 mm、洞底 0、洞顶内存 2.1 m（保存为 2100 mm），在两房最长连续共用段中间；offset 从合并墙 a 端量。两端各留至少 100 mm，空间不足缩宽；缩到小于 600 mm 则不生成，给 warn 和问题卡。
4. 入户门宽 1000 mm、`entry:true`，在指定房间最长的外墙范围中间；同长时按输入边顺序选择。合并墙邻接多房时只用该房所属范围。加 `simple-entry` 问题卡，targets 指向门，说明位置是工具猜的；房间没有外墙则不生成并警告。户外引用在前也能识别；`open:true` 仅用于两房关系，户外关系仍按入户门处理。
5. 房间不存在、两端同房、没有共用边、门放不下，均按原 `doors[i]` 给 warn 与问题卡，不阻断其他房间。重复门或与先前门重叠时跳过后者；同一关系同时有 open 和普通门时，敞开优先。
6. 净面为吸附后的多边形减去所有墙占地矩形的并集（polygon-clipping difference），取面积最大块、去共线点。墙占地逐步合并，每步量化到 0.000001 mm，避免斜墙交接的浮点碎片。敞开边不内缩。扣墙后没有有效净面时省略该房间并给 warn/问题卡；如果重叠造成净面内孔，用 0.01 mm 细缝连到外缘，避免单环 Room.poly 填回已扣除的墙体，并记 note。
7. 房间 id 默认 `r1`、`r2`…，有效显式 id 保留；为避免全局重复，生成 id 避开显式房间 id。重复/无效 id 或占用 `simple-` 问题卡前缀时自动换名并记录。墙、门洞、房间证据统一 `{certainty:'inferred',basis:'简版格式自动生成'}`（`SIMPLE_BASIS`）。层高取 `DEFAULTS.ceiling`。

问题卡 category 都是 original，status 都是 open，编号稳定。固定 `simple-windows`（unknown）提醒补窗。吸附后每对房间重叠超过 0.05 m²，生成 `simple-overlap-N`，带交集 bbox 和两房 targets；房间并集内孔超过 0.1 m²，生成 `simple-hole-N`。外墙平行相对、间距在 (150,600] mm、投影重叠至少 300 mm，且中间没有房间占用，生成 `simple-gap-N`，带 bbox、两房 targets 和毫米缝宽。另有入户门、失败门、米换算等问题卡。

转换结束运行 `validatePlan`。`parsePlanText` 在完整 v2/v3 和 legacy 之前识别简版，报告 `source:'simple'`，填充 counts、approximations、warnings。生成方案带 `meta.source='floorplan-simple'`（`SIMPLE_FORMAT`）；现有 v3 schema 的 meta.source 允许任意字符串，因此保存、重读后仍能用 `isSimpleDerived(plan)` 判断简版来源。

### 格式根本不对的诊断

`diagnoseShape(value)` 接受 JSON.parse 后原始对象，返回 `{wrong:boolean,reasons:string[]}`；不替代字段或几何校验。识别为简版时直接不判 wrong，简版自己的错误走转换器。完整 v2/v3 标记正确、walls/openings/beams/rooms/questions/changes 六数组齐全且不是「rooms 非空、walls 为空」，不判 wrong。`fromLegacy` 能转换出至少一面墙（包括自由墙、洞口宿主）的旧格式也不误判。

其余对象按条件逐条返回短中文原因：顶层非对象；缺 format/version；把 floorplan-structure 写成键（带实际键值）；无顶层 walls/rooms 但子对象含它们（带实际外层键名）；rooms 非空却没有墙；顶层或外层含 doors 数组，或 openings 只有 from/to 关系而无 wall/offset/width。`simpleFormatChatText` 用这些原因、六条规则和模板拼成重试提示；没有原因时省略错误段，直接请求用简版重新输出。

## Agent 构件（C8）

`decor.version` 仍为 1。可选 `decor.components: CustomComponent[]` 保存定义，实例仍是 `Furniture`，以 `type: "custom:<定义 id>"` 引用。定义没有 `by/status`；`id/name/category/size/height/parts` 必填，`category` 为 furniture/appliance/sanitary/lighting/ceiling/plant/soft/storage/other，other 还须写 `label`。`basis` 可记录尺寸依据，`seg` 可指定现有分割类别。实例 size 和 height 与定义一致，容差 1 mm。定义更新会同步同类型实例和其 prev 快照的尺寸。

每张图都是一张 SVG 画布，左上角 `(0,0)`，x 向右，y 向下，单位 mm。**定义里的所有长度在文件和内存中都保持 mm，不进入 METRE_PATHS。**

| 图 / 字段 | 画布与含义 |
| --- | --- |
| plan、extrude.outline | 宽 `size[0]` × 深 `size[1]`；y=0 是背面，y=深是正面 |
| front | 宽 × height；从正面看，y=0 是顶，y=height 是底 |
| side.profile，along=width | 深 × height；沿宽从 span[0] 拉到 span[1] |
| side.profile，along=depth | 宽 × height；沿深从 span[0] 拉到 span[1] |
| revolve.profile | x 是离竖轴的半径（非负），y=0 是顶；center 缺省为俯视画布中心 |

部件共用可选 name/color/material。缺省 kind=extrude，outline 是填充轮廓，`z:[z0,z1]` 从构件底向上量 mm，要求 `0 ≤ z0 < z1 ≤ height`。side/revolve 使用 profile；side 另写 along/span。路径只存 SVG `d`，支持 M/L/H/V/C/S/Q/T/A/Z 大小写、隐式重复及曲线控制点反射，不接受整段 SVG。每条 d 最多 8 KB；曲线默认按 3 mm 容差离散，每子路径至多 256 点（超量均匀降采样）。多子路径以 evenodd/xor 合成孔。边界检查使用更细的离散结果，不使用降采样结果，画布容差 1 mm。

`componentPrisms(def)` 把定义展开成局部棱柱；side/revolve 扫描水平带，斜面/曲面最多 24 带，圆环用 32 边，总计最多 400 棱柱。`componentPlanPaths(def)` 返回显式 plan，否则返回实体俯视投影并集；`componentFrontPaths(def)` 返回显式 front，否则返回棱柱正投影外接矩形并集。plan/front 每条路径带可选 style=outline/detail/dashed、fill/stroke（十六进制色或 none）。front 只供显示，不参与 3D。

`buildDecorSolids` 将画布坐标减去半宽/半深后，依次做 `flip` 的 x 反射、rot 旋转和 at 平移。高度为楼层标高 + 实例底高 + 局部 z/1000，全部实体仍是 `decor-furniture`，多个部件共用实例 id。`DecorSolid.color?:string` 和 material 一并交给界面；白模仍遵循统一白模着色。缺定义时不造占位实体，由校验报 component-missing。镜像翻转 flip，`mirrorPlan` 保留可选字段及精度缓存，两次同轴镜像深相等。

碰撞仍按实例外接矩形粗算，凹形没有精确碰撞。内置 rug、定义 height ≤30 mm 的扁平构件均不参与碰撞。分割按 def.seg（现有类别）或 category 映射：furniture→table、sanitary→toilet、soft→rug、storage→cabinet；现有调色板没有 television/lamp/plant，appliance/lighting/plant 和 other 暂用 box。不存在的 seg 退回类别映射。camera.decor.visible 多部件按实例 id 合并，名称优先实例名，其次定义名。

虚构示例：`fixtures/agent-decor.json`，含挂墙电视、圆地毯、L 形沙发、四腿餐桌和待确认台灯。尺寸仅作测试，不代表具体产品。

## 写入命令（C8）

```sh
node scripts/plan.ts decor-list 方案.json
node scripts/plan.ts decor-edit 方案.json 补丁.json
cat 补丁.json | node scripts/plan.ts decor-edit 方案.json -
node scripts/plan.ts decor 方案.json
node scripts/plan.ts render 方案.json 输出目录 --include-pending
```

`decor-list` 输出家具库（尺寸和高度均 mm）、内置及自定义 styles/materials、componentCategories、components、现有 items，以及按房间划分的 faces。face 带 room/roomName/dir/wall/side/s/length/wallLength/wallKind/openings；length 是该可见区间长度，wallLength 是墙中心线总长，s 与 opening.s 都从墙 a 端量 mm，sill/head 也是 mm。dir 有 north 时按北东南西，无 north 时用上右下左，复用材料位置描述的方位算法。查询针对已确认结构改造后的格局。

`decor-edit` 只接受 v3；补丁为 `{"ops":[...]}`，全部成功才原地原子写入。直接操作文件的 mm 形状，校验通过 parsePlanText 的统一边界。仅替换顶层 decor 值的原文区段，其他字段、键序、空白、数字写法、BOM、底图和未知字段逐字节保留；新增 decor 只在根对象闭括号前插入。装修编辑/查询允许保留 decor 外的未知字段，其他入口仍保持严格格式校验。原文件若在处理期间变化则拒绝覆盖；错误退出 1 并给出 op 序号及字段问题。

| op | 参数与行为 |
| --- | --- |
| init | style 可省略（cream）；已有 decor 报错 |
| style | style 必须为内置风格或 presets 中 id |
| add | kind=furniture/cabinet/panel/recess/surface/door，item，status?，wall?，ceiling?；省略 id 自动按 newId 规则生成 |
| update | id、set、unset? 字段名数组、status?；浅合并，不可改 id。柜体只给 set.width（不给 columns）时走 `resizeCabinet`：末列承担，放不下才按比例，和界面同一条规则 |
| remove | id；仍被 in 或 hole.host 引用时报错，先处理子项 |
| confirm / reject | ids；确认清 prev；否掉恢复 prev，无 prev 的提议删除；可一起否掉父子提议 |
| component | component；同 id 替换定义并同步实例 size/height；custom 实例 add 可省略 size/height |
| preset | preset；新增或同 id 替换，by 固定 agent，不自动切换 style |
| material | material；新增或同 id 替换 |
| rehost | 采纳 decor 查询的 rehosted，维护最后位置缓存 |

add/update 的 by 固定 agent，status 不写就是 pending，用户已明确要求的应显式传 `status:"confirmed"`。item/set 不允许带 ack/by/prev/cache，unset 也不能移除受保护字段。ack 只由用户在工具中记录。用到的内置材料自动复制入 materials。成功输出 `{ok:true,applied:n,issues:[warn…],items:[{id,status,kind}]}`，不改结构 changes。

挂墙便捷写法仅用于 add furniture：

```json
{"ops":[{"op":"add","kind":"furniture","status":"confirmed","item":{"type":"sofa-3","size":[2400,900],"height":850},"wall":{"face":{"wall":"north","side":1},"s":3500,"gap":0,"z":0}}]}
```

s 为家具中心沿墙中心线离 a 端 mm，gap 是背面离墙面的距离，z 是底离本层地面的高度（缺省 0）。命令复用 faceAxis 计算 at/rot/against，正面朝指定侧房间；wall 与 in 不能同时使用，墙不存在、s 越界或负 gap/z 都报错。未知 type 发 unknown-type 警告并列三个相近 id；小于 3 mm / 大于 10 m 的家具高度、小于 10 mm 的 size、柜体/造型/壁龛小于 10 mm 的高度段报 unit-suspect。柜列宽度继续由 layoutCabinet 校验。任何校验 error 均不写入。

confirmed 项被 update 为 pending 时，其改前完整内容进入 `prev?:Record<string,unknown>`；后续 pending 更新继续保留最初快照，确认清除、否掉恢复。prev 必须是同 id 的 confirmed 项且不能再嵌套 prev。快照的嵌套高度（含柜格、台面、家电位、层板、surface.target.z）与当前项一起做文件 mm / 内存 m 换算。

`confirmedDecor(decor)` 返回副本：pending 有 prev 用旧内容，无 prev 去掉，挂在被去掉宿主上的子项也递归去掉。`restoreDecorItem(item)` 返回拒绝后的项（新提议返回 undefined），供界面复用。默认 render 和材料粗估均使用此确认视图；`--include-pending` 显式画当前提议。白模、深度、线稿、分割与洞口遮罩共用同一实体过滤。camera.decor 记录 pendingHidden 和 includePending，stderr 提示隐藏数量。decor 命令在顶层输出 pendingCount；materials 是确认视图的粗估。


## 门的外观、吊顶（C9）

`DecorBase.look?: string` 和 `CustomComponent.look?: string` 保存一句外观描述，不改变几何。按 Unicode 码点计数，最多 300 字；超长或类型不对报 `invalid`。`decor-edit` 的 add/update 可以写 look，定义通过 component 写。家具外观取 `f.look ?? componentOf(decor, f.type)?.look`，摆放项优先（空字符串也覆盖定义）；其他构件取自身 look。`camera.decor.visible[]` 只在该项实际可见且有描述时带 look。

### 吊顶与顶上灯具

`ComponentCategory` 新增 `ceiling`，中文“吊顶”。分割沿用 raster 的 `ceiling` 类（ADE20K RGB `[120,120,80]`）；已有的有效 `def.seg` 覆盖规则保持。灯具仍属于 lighting，分割缺省 box。

`isOverhead(plan, f): boolean` 位于 `decor/furniture.ts`，从 core decor 索引导出：定义类别为 ceiling 时直接成立；lighting 则要求构件顶 `pose.z + f.height` 与所在房间顶面相差不超过 50 mm（包含边界，向上越过 50 mm 也不算）。用摆放点所在楼层的房间层高；找不到房间时用靠墙宿主高度，否则本层最高有效墙高，再无墙用本层默认层高。房间和实例高度均是相对本层楼面的内存 m，楼层标高不参与这个差值。普通落地灯、台灯不满足贴顶条件。

render 先应用 confirmedDecor（或 includePending 当前提议），再按机位过滤：room:* 和自定义相机显示顶上物件；iso-*、top 和任何显式 section 隐藏。所有通道共用过滤，包含白模、深度、线稿、分割和洞口遮罩；白模形状仍由 parts 产生。`camera.decor.overheadHidden` 是因当前机位隐藏的摆放项数量，多部件只计一次，只计所选楼层；它在状态过滤之后统计，不与 pendingHidden 重复。关闭装修或原始状态跳过装修时为 0。家具碰撞/净距和房间机位避障都排除顶上物件。

add furniture 可用下面的便捷定位，与 wall 互斥，也不能同时给 item.in/against：

```json
{"ops":[{"op":"add","kind":"furniture","status":"confirmed","item":{"id":"ceiling-1","type":"custom:ceiling-living","look":"暖白石膏，四周隐藏灯带"},"ceiling":{"room":"r-living"}}]}
```

前提是已存在该 custom 定义。命令保存普通 Furniture：`z = roomCeiling × 1000 − item.height`，顶贴房间顶面；at 缺省房间外接框中心，rot 缺省 0，保留显式 at/rot，level 跟房间走。房间不存在时列出可选房间 id，构件高超过层高时拒绝，所有失败均保持文件不变。这里所有文件长度仍是 mm。

### 门外观 DoorFinish

可选数组 `decor.doors?: DoorFinish[]`，每项继承 DecorBase；没有此数组的旧文件行为不变。字段如下：

| 字段 | 规则 |
| --- | --- |
| opening | 唯一引用一个现存、洞底贴地且有门扇的 Opening；当前种类为 door、sliding |
| color / material | 门扇 color 为 #RRGGBB 或材料 id；material 是材料 id |
| frame | 可选 `{color?,material?}`，颜色和材料规则同上 |
| front | ComponentPath[]；画布为洞口宽 × 洞口高 mm，y=0 为顶；共享构件路径语法、样式、色值与 1 mm 画布容差校验 |
| flip | 正面图 x 反射，显示坐标为“洞口宽 − x”；mirrorPlan 翻转它及 prev，双次同轴镜像精确往返 |
| look | 一句外观描述，最多 300 字 |

门的位置、宽高、开法和白模几何仍由 Opening 决定，front 不参与 3D。同一 opening 只能有一条外观，无论 pending/confirmed。doorway 拒绝并提示“门洞没有门扇，要做门套用造型 arch”；未知 opening 拒绝。已确认改造拆掉宿主时保留外观数据，报 host-missing，不阻断 validate、写入或出图。

`decor-edit` 使用 `kind:"door"`，支持 add/update/remove/confirm/reject，含完整 prev 恢复；confirmedDecor、pendingCount 和 core 的确认/否掉辅助函数均包含 doors。color、material 和 frame 引用的内置材料会自动复制到 decor.materials。

```json
{"ops":[{"op":"add","kind":"door","status":"confirmed","item":{"id":"door-look-1","opening":"o-entry","look":"胡桃木竖纹门扇，黑色细门框","color":"#705040","frame":{"color":"#111111"},"front":[{"d":"M20 20H880V2080H20Z","style":"outline"}]}}]}
```

`camera.openings[]` 及 openingMasks 的对应条目附带存在的 look/color，默认采用已确认外观（pending 带 prev 时采用旧内容），includePending 采用当前提议。关闭装修或原始状态跳过装修时不附外观。不可见洞口不进入 camera.openings。

`decor-list` 顶层 doors 返回现有 DoorFinish 数组（包括状态及 prev）；`faces[].openings[].door` 为该洞口已有外观的 id，无外观时省略；items 中 kind 为 door。`decorHandoff` 使用“门的外观”标签。front 路径、flip 和 look 在文件与内存中不换算单位。
