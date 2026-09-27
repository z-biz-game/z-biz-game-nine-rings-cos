# 九连环 - 交付报告

读者：接手的维护者代理。本文件只登记**磁盘上真实存在、且在本次会话里被命令跑绿过**的东西。
下面每一条声称都指到一个具体文件与一条能跑的命令；所有输出行都是本机实跑后原样粘贴，
不是从 README.md / DESIGN.md 里抄的文字（抄来的部分会标注来源，并在 §6 列出与实跑不符的几处）。

本次会话**只新增本文件**：没有修改任何其它文件的**内容**，没有新增功能，没有执行任何 git 写操作。
唯一被写过的第二个路径是 `js/data/levels.js`——它是 `node tools/bake.mjs`（交付要求实跑的命令之一）的产物；
重跑两次做 `diff` 得 **byte-identical**（md5 `cc63f707e75daff7797016e65757a9fa`，64 行关卡不变），
所以它是"被重新量了一遍、数值没动"，不是被编辑过。见 §4.1 末尾。

---

## 摘要

| 项 | 值 | 复现命令 |
|---|---|---|
| **App 名称** | 九连环 | `head -1 README.md` → `# 九连环 · NINE RINGS`（取中文部分） |
| 仓 | `/Users/zifang/workplace/ceo_workplace/z-biz-game/z-biz-game-nine-rings-cos` | — |
| 显示名 / 路由 | `#/lot/<id>`、`#/daily`，另有 `#/c/<index>`、`#/random/<band>/<token>` | `js/main.js:53-64`（`parseHash`）；`node --test test/library.test.mjs` |
| 测试钩子 | `window.rings` | `js/main.js:404`；`bash tools/verify.sh` 的 boot 轮询就是读它（实跑回显 `boot level: novice-01`） |
| 主张 | 每关 `par` = 512 结点穷尽 BFS 的距离，与闭式公式对账 | `node tools/bake.mjs`（§4）、`node --test test/formula.test.mjs` |
| node 断言 | **62 条，fail 0**（6 个文件） | `node --test test/`（原文见 §5.2） |
| 浏览器断言 | **94 条，fail 0**（6 段：boot 17 / play 17 / routes 17 / save 13 / reloaded 6 / pointer 24） | `SKIP_UNIT=1 bash tools/verify.sh`（原文见 §5.3） |
| npm 依赖 | `dependencies = {}`、`devDependencies = {}` | `node -e 'const p=require("./package.json");console.log(p.dependencies,p.devDependencies)'` → `{} {}` |
| 二进制资产 | 0（无 png/mp3/字体；画面是 canvas 2D 程序绘制） | `find . -type f ! -name '*.md' ! -name '*.js' ! -name '*.mjs' ! -name '*.cjs' ! -name '*.css' ! -name '*.html' ! -name '*.json' ! -name '*.sh' ! -name '*.yml'` → 只有 `LICENSE`、`.gitignore` |
| 磁盘文件 | 32 个（本文件写完后 33），源码/样式/脚本 4225 行 | `find . -type f -not -path './.git/*' \| wc -l` |
| 未实现清单 | 11 条（含 4 处文档/注释与实跑数字不符 §6-3…§6-6；另有 2 条规格主张被实测否证，见 §2 的 #4/#5） | 见 §6 |

---

## 1. 文件清单 —— 每个文件由谁验证

"由谁验证"指的是**具体测试文件或具体命令**；没有门禁的文件明确写"无门禁"，不假称有。

### 壳与画面

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `index.html` | 壳：顶栏 / `#sword` 画布 / 右侧面板 / 通关卡；`<link rel="icon" href="data:,">` | `tools/playtest.mjs:224-226` 的 `@pointer` 第一条逐个 `getElementById` 20 个 id（`sword modes totals crumbs readout hintline curtain stars verdict tally again next undo hint demo restart share shelf wipe toast`）；`@boot` 第一条（`playtest.mjs:386`）。favicon 那条由 `tools/verify.sh:119` 的 "console 干净" 检查覆盖——本次实跑末段是 `=== console ===` + `(none)` |
| `css/game.css` | 全部样式，单文件 | `@boot` "the canvas is laid out, not the unstyled 300x150 default"（`playtest.mjs:396`）；命令同 §5.3 |
| `js/view.js` | canvas 绘制（剑 + 9 环两行之间的位移）、指针手势、`ringPoint(k)` | `@boot`(17)、`@play`(17)、`@pointer`(24)——真实 `Input.dispatchMouseEvent` 的坐标就取自 `js/view.js:340` 的 `ringPoint`；另有 `test/game.test.mjs:194` "no shipped shell or view re-derives the bit layout" 直接读它的源码 |
| `js/main.js` | 路由、DOM、存档写入、`window.rings`（`js/main.js:404-458`） | `@routes`(17) + `@save`(13) + `@pointer`(24)；源码扫描同上 |

### js/core/*（纯函数层，`node --test` 直接 import）

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `js/core/game.js` | 唯一合法性谓词 `canToggle`（`:36`）、`isOn`（`:23`）、`click`（`:86`）、undo/reset/hint/grade | `test/game.test.mjs`(12)、`test/solve.test.mjs`(15)、`test/formula.test.mjs`(6) → `node --test test/` |
| `js/core/solve.js` | `buildTable(n,root)` 穷尽 BFS（`:39`）、`table()` 缓存（`:127`）、`formula(n)`（`:30`）、`bandCuts`（`:140`） | `test/solve.test.mjs`（含 "the exhaustive sweep really covers all 512 positions, and is fast" 的 `ms < 20`）、`test/formula.test.mjs`；n=13/14 的一次性对账命令见 §4.3 |
| `js/core/make.js` | 难度带在模块加载时由直方图现算（`:39`）、`statesAtPar`（`:47`）、`makeLevel`（`:56`）、`makeSet` | `test/make.test.mjs`(10)；生成器实测行见 §4.1 的 `generator:` 输出 |
| `js/core/library.js` | 战役 64 关查表 + `validateLevel`（`:33`）+ `dailyLevel`/`randomLevel` + `stats()` | `test/library.test.mjs`(9)（逐行复算 `par === dist[state]`）；产物重写门是 `node tools/bake.mjs` |
| `js/core/storage.js` | localStorage 存档，`store`（`:61`）；无 window / 存储被拒时退化内存 | `test/storage.test.mjs`(10)；浏览器侧 `@save`(13) + `@reloaded`(6) |
| `js/core/rng.js` | FNV-1a `hashSeed` + `mulberry32`（契约 §1 要求从 gridlock 原样搬运） | **无独立测试文件**。间接证据：`test/library.test.mjs:130` "a shared pick is the same pick, on any device"、`test/make.test.mjs:80` "a seed is a level"，浏览器侧 `@routes` 的 "the daily route is the same puzzle twice" / "#/random/\<band\> stays in its band and repeats itself" |
| `js/data/levels.js` | 构建期产物：`HISTOGRAM`、`TIERS_META`、64 行带实测 par 的关卡 | `test/library.test.mjs`（对磁盘上的行独立复算）+ `node tools/bake.mjs`（`tools/bake.mjs:63-68` 两条款，不满足直接 throw） |

### 服务器与桌面壳

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `server.cjs` | 零依赖静态服务器，默认端口 5181（`server.cjs:48,59`） | `tools/verify.sh:32` 起它、`:54-59` 轮询 `$BASE` 才继续；本次实跑通过（`opened http://127.0.0.1:5181/` + `boot level: novice-01`） |
| `electron/main.cjs` | 桌面壳，复用 `server.cjs` 且 `port: 0`（`:7-8`） | **只有语法门禁**：`npm run check` 的 `node --check electron/main.cjs`。**未真实启动过**（仓内不装 electron，README.md:130 已声明），见 §6-1 |

### tools/ 与 test/

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `tools/bake.mjs` | 量空间 → 量生成器 → 出题并复验 → 写 `js/data/levels.js` | 本次实跑，输出见 §4.1；其产物再由 `node --test test/library.test.mjs` 独立复算 |
| `tools/harness.mjs` | 微型框架：`test/ok/eq/run`，node 与浏览器套件同形状 | 每个 `rows: N fail: M` 行都是它打的（§5.2 的 6 行）；`tools/verify.sh:95-116` 按同一形状解析浏览器段 |
| `tools/playtest.mjs` | 零依赖 CDP 驱动：`open/nav/eval/tap/shot/logs`，`waitShell` 轮询、`@pointer` 真鼠标 | 本次实跑（经 verify.sh）；单条可手工复现：`node tools/playtest.mjs tap 0` |
| `tools/verify.sh` | 一次性验收门（独立 profile、双端点轮询、`trap cleanup EXIT` 里 `wait`、花括号计数截 JSON、支持 `SKIP_UNIT=1`） | 本次实跑，原文见 §5.3 |
| `test/fixture.mjs` | 手算期望：`HAND`（a(k)=2^k−1 的递推 + 手写路线）、`ILLEGAL`、`LEGAL`、`FULL9` | 被 `test/solve.test.mjs` / `test/game.test.mjs` import；"no shorter click sequence clears those positions (exhaustive)" 用另一套算法（深度受限 DFS）反证更短解不存在 |
| `test/formula.test.mjs` (6) | 闭式对账 n=1..12、171/341 反证、Gray-code 秩逐位比对 | `node --test test/` |
| `test/game.test.mjs` (12) | 计数/撤销/评星/非法点击免费 + 源码扫描 | 同上 |
| `test/library.test.mjs` (9) | 已发布 64 关逐行复算、校验器负例、带不重叠 | 同上 |
| `test/make.test.mjs` (10) | 带算术、一距一位、接受率 400/400、生成耗时上界 | 同上 |
| `test/solve.test.mjs` (15) | 512/512 覆盖、路径性、`next[]` 回放、纯函数性、a(9)=511 | 同上 |
| `test/storage.test.mjs` (10) | best 只降、unlock 只升、清档、无 window 退化内存 | 同上 |
| `test/balance.mjs` | **量具，不是门禁**：本仓所有难度数字的来源 | 本次实跑，行见 §4.2 |

### 其它

| 文件 | 作用 | 由谁验证 |
|---|---|---|
| `package.json` | `"type":"module"`、零依赖、`check/unit/bake/balance/verify` 脚本 | `npm run check` rc=0（§5.1）；依赖为空见摘要表命令 |
| `.github/workflows/ci.yml` | unit job（`node --check` 全量 + 逐个 `test/*.test.mjs`）+ browser job（`SKIP_UNIT=1`） | **本机未执行 Actions**（无远端推送）。两条命令在本地各自等价于 §5.1 与 §5.3 实跑过的内容 |
| `.github/workflows/pages.yml` | 文件拷贝式部署：只 `cp index.html` + `cp -r css js` | **本机未执行**；被拷的三样东西由 §5.3 的浏览器套件跑过 |
| `README.md` / `DESIGN.md` | 玩法与面向维护者的约束/踩坑说明 | **无自动门禁**。数字复现命令是 `node test/balance.mjs` 与 `node tools/bake.mjs`；其中 4 处文字与本次实跑不一致，列在 §6-3…§6-6 |
| `.gitignore` / `LICENSE` | 忽略物；MIT，`Copyright (c) 2026 z-biz-game` | `head -4 LICENSE` |
| `deliverable.md` | 本文件 | 自身无门禁；内容指向 §4/§5 的实跑输出 |

---

## 2. 改动表（先写错在哪 → 为什么对）

本表的每一条都能在 `DESIGN.md` §1.2 / §2 / §3 / §5 / §6 / §7.4 或 `js/core/*.js`、`tools/playtest.mjs` 的行内注释里找到出处；
本节把它们消化成表，不另起一套说法。
来源标法（每行第一格里的方括号标签）：**[本仓真踩过的]** = 这份代码里确实写过、DESIGN/代码注释记录了；
**[家族教训]** = 契约 §2 与 `DESIGN.md` §7 记的上一仓实跑故障，本仓一开始就按教训写；
**[规格主张，被实测否证]** = 简报 `/tmp/puzzle-brief/nine-rings.md` 写错，本仓按实测交付；
**[风险类，未记录为已发生]** = 只是容易错、DESIGN 要求"错法要有对应的钉"，本仓没有提交过；
**[本次核查新发现，未修]** = 这一轮读文件时发现的文档缺陷，本任务禁止改其它文件所以只登记。
"现在的钉"必须是能跑的命令或磁盘上的断言名，不是叙述。

| # | 当时错在哪 | 为什么这样才对 | 现在的钉 |
|---|---|---|---|
| 1 | **[本仓真踩过的]** 把 `k === 1`（环 2）特判成"和环 1 一样总能动" | 那是一行"简化"，图依然连通、512 个位置依然全覆盖，但它是**另一个更简单的玩具**：全上→全下量出 171，不是 341。环 2 必须要求环 1 在剑上 | `test/formula.test.mjs:64-100` 把错的谓词抄进测试、跑同一次 BFS，断言"它确实到 171 且确实覆盖 512 个位置"，因此覆盖率检查抓不到它——只有绝对数字能抓。跑：`node --test test/` |
| 2 | **[风险类，未记录为已发生]** 掩码下标 off-by-one：`state & ((1 << k) - 1)` | 那样会把"要求 bit k−1 为 1"的那位也算进"必须为 0"，两个条件互斥 ⇒ 环 2 以上永远拨不动，游戏退化成只有环 1 能动 | `js/core/game.js:39` 用 `(1 << (k - 1)) - 1`；正反例夹击在 `test/fixture.mjs` 的 `ILLEGAL`/`LEGAL`，由 `test/solve.test.mjs` "the rule says no/yes where the fixture says ..." 逐条钉 |
| 3 | **[本仓真踩过的]** `js/main.js` 自己写 `(state >> k) & 1`、`js/view.js` 用四处 `bitAt(...) === 1` | 位布局是 `game.js` 的知识。shell 里出现第二份位移，规则改了它不跟着改，画面与文案会**安静地说谎**（规则本身还是对的，最难查） | 统一走 `isOn`；`test/game.test.mjs:194` "no shipped shell or view re-derives the bit layout" 直接读 `js/main.js`/`js/view.js` 源码，出现 `>> k`、`& 1)`、`bitAt(` 即失败，并要求 `isOn(` 真的被用到 |
| 4 | **[规格主张，被实测否证]** 规格 §2 写"直径：n=9 时 `max(dist)` 必须是 341" | 两个不同的数被合成了一句：以空剑为根时 `dist[全1] = 341 = (2^10−1)/3`（闭式量的是它），而 `max(dist) = 511`，取在位置 256（只有第 9 环在剑上）。按规格那句话写断言要么红，要么有人把根改成"全上"来凑绿 | 两条分开钉：`test/solve.test.mjs:66` "a(9) = 511: the deepest single ring is the far end of the graph"；`test/formula.test.mjs:51` "the eccentricity of the all-on position is 341, its diameter is not"（341 与 511 在同一条断言里对照）。解释在 `DESIGN.md` §1.2 |
| 5 | **[规格主张，被实测否证]** 规格 §3 预估难度带 `1–7 / 8–31 / 32–127 / 128–341` | 那要求距离按 2 的幂堆积（图"深而窄"）。这张图是一条路径：`degree 1-2`、`reached 512`、每个距离恰好一个位置 ⇒ 直方图是平的，等分位数只能切出等宽区间 | 带在加载时现算（`js/core/make.js:39` → `bandCuts`），实测 `1-128(128) 129-256(128) 257-383(127) 384-511(128)`，见 §4.2 的 `parts=4` 行；钉在 `test/make.test.mjs:18` 与 `test/library.test.mjs` "the bands are the histogram..." |
| 6 | **[家族教训]** 把"生成包络"与"已发布关卡的 min/max"当同一个数（DESIGN.md §3 记为 gridlock 仓抄错过的格） | `TIERS` 是生成时允许哪些 par；`TIERS_META` 是 16 关实际落成什么。UI 印的是后者，两者并排存着才不会静默合并 | `tools/bake.mjs:76-87` 从入库行里量 `TIERS_META`；`test/library.test.mjs:73` "the bands on screen are the bands in the file, and they do not overlap" 与 `:88` 比对 `envelope`/`HISTOGRAM.cuts`/shipped 三者 |
| 7 | **[本仓真踩过的]** 场景体（写在模板字面量里的页面源码）里正则用单反斜杠 `\/` | 单反斜杠被模板吃掉，页面收到未闭合的正则字面量，整段 `@save` 在**解析期**就抛 `SyntaxError: Invalid regular expression flags`，一条断言都没跑 | 硬规矩"体内不写反引号、不写单反斜杠斜杠"，注释在 `tools/playtest.mjs:604-608`；实跑 `=== @save === rows: 13 fail: []`（§5.3） |
| 8 | **[本仓真踩过的]** 六段共用同一页面时不清 `window.__lastRows` | 上一段的行缓冲还在：某段抛在解析期时，聚合器把**上一段的 rows** 当本段成绩打印（`@save` 曾报 `rows: 18` 而它实际一条没跑）——坏掉的台架看起来是绿的 | `tools/playtest.mjs:170` 每段执行前 `window.__lastRows = null`，抛错时补一条 `@<name> threw` 的失败行（`:173-177`） |
| 9 | **[本仓真踩过的]** 三条断言用 `/已通 <b>N<\/b>/` 去匹配 `.textContent` | `textContent` 按定义不含标记，所以无论屏幕印什么都不可能为真。改的是台架不是期望值：`innerHTML`，**期望字符串一个字没动** | `tools/playtest.mjs:588/618/640` 用 `.innerHTML`；本次 `@save`/`@reloaded` 全绿 |
| 10 | **[家族教训]** `Page.navigate` 之后固定 `sleep()` | 本地够用、线上不够：`window.rings` 还没出现就开始断言，canvas 停在未样式的 300×150，一次无辜部署会产三条假故障 | `waitShell()` 轮询 `window.rings.state.id`（`tools/playtest.mjs:116-128`）；`tools/verify.sh:79-84` 同口径轮询 boot 关卡 |
| 11 | **[风险类，未记录为已发生]** `canvas.getContext('2d')` 未带 `willReadFrequently` | 台架用 `getImageData` 回读像素证明"合法点击改画面、非法点击不改"；没这个标志 Chrome 每次回读打一条 warning，会淹没"console 必须干净"那条断言 | `js/view.js:35`；`tools/verify.sh:119-123` 的检查 + 本次 `=== console === (none)` |
| 12 | **[家族教训]** 没有 `<link rel="icon" href="data:,">` | favicon 404 是纯噪音，但它会踩掉"console 干净"这条断言 | `index.html:8`；同上 |
| 13 | **[本仓真踩过的]** headless 把自己报成 hidden，于是接了 `visibilitychange` 去暂停 rAF | 通关动画与胜利卡片由同一个 rAF 循环驱动，一暂停测试永远看不到通关 | `js/main.js:398-402` 显式不接该事件（注释说明理由）；钉在 `@pointer` "the sword is empty and the level is won" + "the win card goes up with three stars" |
| 14 | **[本仓真写过、后删]** `solve.js` 里曾有 `distOf(state, n)`、`library` 侧曾有 `tableForLevel(n)`、`game.js` 侧曾有 `stateOfBits(bits)` | 一个缓存两个名字 ⇒ 未来编辑会让它们各自长身体；`distOf(state, n)` 邀请调用方传一个与所玩关卡不一致的 `n`；位置本身就是掩码，`bits → state` 只会被"反过来验 `bitsOf`"的东西要，而那处（`test/solve.test.mjs` "bitsOf and toggle round-trip a position"）故意手搓期望掩码，好让 shipped helper 不当自己的 oracle | 三个都已删除而不是接线（注释在 `js/core/solve.js:117-125`、`js/core/game.js:60-64`）。替代证据：`test/solve.test.mjs:188` "a distance belongs to the bits, not to the ring count named" 量遍 n=1..9 |
| 15 | **[风险类，未记录为已发生]** `reset()` 只清 localStorage、留内存缓存（DESIGN §5 记为隐患） | 陈旧缓存比不清档更糟：屏幕说清了、纪录还会回来 | `js/core/storage.js:113-121` 连 `cache` 一起换；`test/storage.test.mjs:170` "a save survives a reload, and a wipe really wipes" + `@save` "清空存档 takes two clicks and clears everything"、`@reloaded` "and a reset leaves nothing on disk for the next visitor" |
| 16 | **[风险类，未记录为已发生]** 环数上界若做**钳制**而不是抛错（`buildTable(n)` / `formula(n)` 的边界） | 钳制会把越界调用静默变成"算了个小 n"，屏幕上照样印一个数、只是答非所问。本仓 `buildTable` 越界**直接 throw**（n ≤ 16），`formula` 钳在 1 ≤ n ≤ 51（`Number` 到 n=51 才失真） | `js/core/solve.js:31,40`；`@boot` "and the page refuses an out-of-range ring count"（`playtest.mjs:423`）；上界之外刻意不做（§6-10 与 `DESIGN.md` §8） |
| 17 | `README.md:23` 曾写 `node server.cjs # http://127.0.0.1:5180/` | 实现默认端口是 **5181**（`server.cjs:48,59`），`verify.sh` 的 `WEB_PORT` 与 `playtest.mjs` 的 `BASE` 也都是 5181；照 README 抄会连不上 | **已改为 5181**（主代理核查后修）。复现：`grep -rn "5180\|5181" README.md server.cjs tools/` 现只回 5181 |
| 18 | `js/main.js:37` 注释曾引用 "DESIGN.md 1.3" | `DESIGN.md` 只有 1、1.1、1.2…，相关内容在 §1.1；指向不存在的节会让维护者按错的坐标找约束 | **已改为 §1.1**。复现：`grep -rn "DESIGN.md" js/main.js` |

---

## 3. 磁盘事实（本次核查，命令与输出对应）

| 声称 | 命令 | 实测 |
|---|---|---|
| `js/core/*` 不碰 DOM，故 `node --test` 能直接 import | `grep -rn "window\.\|document\." js/core/` | 3 行命中，全部在 `js/core/storage.js:28,55,116`，且 `:28` 是守卫式 `typeof window !== 'undefined'` —— 契约 §5 明示的唯一豁免 |
| 零依赖 | `node -e` 读 `package.json` | `dependencies {}`、`devDependencies {}` |
| 无 `node_modules` | `ls node_modules` | `No such file or directory` |
| 无二进制资产 | 摘要表里的 `find` | 只剩 `LICENSE`、`.gitignore` |
| 无未接线的模块级导出 | `grep -rn "mulberry32\|shuffle\|\.chance(\|\.range(" js test tools` → 命中全在 `js/core/rng.js:16,29,41,42`；调用方 `grep -rn "\.pick(\|\.int(" js test tools \| grep -v core/rng.js` → 只有 `js/core/make.js:61,69,96` | 模块级导出都有外部调用方；`mulberry32` 只被 `rngFrom`（同文件 `:41-42`）用，`rng.range`/`rng.chance`/`rng.shuffle`（`:26,28,29` 定义）无任何调用方。契约 §1 要求 `rng.js` 原样搬运，与 §5 的"无人调用则删"在这一格冲突，本仓按 §1 保留——见 §6-7。另有 `window.rings.undoOnce` 一条未接线钩子，同见 §6-7 |
| 关卡数据确实是产物 | `grep -c '^  {' js/data/levels.js` | `64` |

---

## 4. 数字从哪来（一条命令复现那张表）

### 4.1 `node tools/bake.mjs` —— 本次实跑，原样粘贴

```
$ node tools/bake.mjs
table: {"n":9,"nodes":512,"reached":512,"complete":true,"isPath":true,"degree":"1-2","allOn":341,"closedForm":341,"maxDist":511,"atState":256,"distinctDists":512}
bands: [{"key":"novice","label":"初摘","n":9,"min":1,"max":128,"states":128,"blurb":"1-128 步"},{"key":"linked","label":"连环","n":9,"min":129,"max":256,"states":128,"blurb":"129-256 步"},{"key":"twined","label":"缠枝","n":9,"min":257,"max":383,"states":127,"blurb":"257-383 步"},{"key":"master","label":"九转","n":9,"min":384,"max":511,"states":128,"blurb":"384-511 步"}]
generator: 800 levels made, accepted 800/800 (100.0%), 0.0037 ms/level
wrote 64 levels (novice:16 linked:16 twined:16 master:16) -> js/data/levels.js
spread check: novice=16 linked=16 twined=16 master=16
bands shipped: novice 1-128 | linked 129-256 | twined 257-383 | master 384-511
histogram: {"nodes":512,"distinctDistances":512,"maxCount":1,"maxDist":511,"atState":256,"flat":true,"allOnDist":341,"closedForm":341,"cuts":[{"key":"novice","min":1,"max":128,"states":128},{"key":"linked","min":129,"max":256,"states":128},{"key":"twined","min":257,"max":383,"states":127},{"key":"master","min":384,"max":511,"states":128}]}
rc=0
```

按交付要求逐项读出这一条命令给出的事实：

| 要报的 | 实跑值 | 出处行 |
|---|---|---|
| 题数 | **64 关**（`novice:16 linked:16 twined:16 master:16`） | `wrote 64 levels ...` |
| 每档 par 范围（生成包络） | 1-128 / 129-256 / 257-383 / 384-511，各含 128/128/127/128 个位置 | `bands:` 行 |
| 每档 par 范围（已发布落成，UI 印的就是它） | novice 1-128、linked 129-256、twined 257-383、master 384-511 | `bands shipped:` 行 |
| 耗时 | **0.0037 ms/关**（4 带 × 200 种子 = 800 关的均值） | `generator:` 行 |
| 接受率 | **800/800 = 100.0%** | `generator:` 行 |
| 拒绝原因 | **无拒绝**。`makeLevel` 唯一的拒绝分支是"带广告了一个表里不存在的距离"（`js/core/make.js:68`），而带由表证明非空，所以它不响；`tools/bake.mjs:46` 把"接受率不满"设成构建失败，不是日志 | `generator:` 行的 `800/800` + `tools/bake.mjs:40-46` |
| 复现命令 | 就是 `node tools/bake.mjs` 这一条（可选 `PER_BAND=24`、`PROBE=2000` 两个环境变量，见 `tools/bake.mjs:13-15`） | — |

**幂等性（这条命令会写文件，所以必须验）**：`cp js/data/levels.js /tmp/ && node tools/bake.mjs && diff` 实跑得
`bake is idempotent: levels.js byte-identical across two runs`，两遍 md5 都是 `cc63f707e75daff7797016e65757a9fa`、
`grep -c '^  {' js/data/levels.js` 仍是 `64`。也就是说 §4.1 的 `table:/bands:/generator:/histogram:` 四行
不是一次性观察，而是同一份种子下一次复现的产物；重写之后 `node --test test/`（§5.2，第二次跑）与
`SKIP_UNIT=1 bash tools/verify.sh`（§5.3）都是绿的，两者都会独立复算这 64 行。

### 4.2 `node test/balance.mjs` —— 文档里那张难度表的量具（本次实跑）

```
$ node test/balance.mjs
# 状态空间（穷尽）
位置数 2^n | 512          到达数 | 512          全部可达 | true
图形状 | 一条路径（度 1-2）
全上→全下（搜索） | 341     全上→全下（闭式 (2^10-1)/3） | 341
最深的距离 | 511 @ 位置 256 (0b100000000)
不同距离数 | 512           每个距离的位置数最多 | 1
25 次完整 BFS (ms) | 中位 0.056 · 最快 0.049 · 最慢 0.161

parts=4 | 1-128(128)  129-256(128)  257-383(127)  384-511(128)
n=9 每一格 | novice 1-128(128)  linked 129-256(128)  twined 257-383(127)  master 384-511(128)

# 每一带的形状（整带 128/127 个位置，不是已发布 16 关）
band | par 范围 | 位置数 | 实测: 剑上环数 min/med/max | 可拨环数分布
novice | 1-128 | 128 | 1/3/7 | 2:128
linked | 129-256 | 128 | 1/4/8 | 2:128
twined | 257-383 | 127 | 3/6/9 | 2:127
master | 384-511 | 128 | 1/4/8 | 1:1 2:127

# 生成器（每带 500 个种子）
novice | 500/500 | 1/67/128 | 0.0013 | 0.2072
linked | 500/500 | 129/190/256 | 0.0010 | 0.0157
twined | 500/500 | 257/321/383 | 0.0008 | 0.0100
master | 500/500 | 384/445/511 | 0.0011 | 0.0284

# 已发布关卡池
关数 | 64      总关 par 合计 | 16392      最难一关 | master-16 · 511 步
各带 par 中位数 | novice 65 · linked 193 · twined 320 · master 448
各带剑上环数 | novice 1-6 · linked 2-7 · twined 3-9 · master 1-8

# 逐关复验（照 next[] 走一遍，看是不是恰好 par 步）
关数 | 64      全部走完 par 合计 | 16392      最难 | master-16 · 511 步
走完 64 关的总耗时 (ms) | 1.37
```

（上块把多行 `key | value` 折成了几行以便阅读；每一行都是原输出，未改数字。**注意 `balance.mjs` 不是门禁**，它没有 `rows/fail`，只印量出来的数。）

难度带的四个区间能这么整齐，是因为图是一条路径（`degree 1-2`、512 个位置全覆盖、每个距离恰好一个位置 ⇒ 直方图平的），等分位数只能切出等宽段。规格预估的几何级数带 `1–7 / 8–31 / …` 隐含"距离按 2 的幂堆积"，实测为假（改动表 #5）。

### 4.3 闭式对账补到 n = 13、14（`DESIGN.md` §9 前向引用的是本节）

`test/formula.test.mjs` 钉的是 n = 1..12（PUBLISHED 表手抄）。n = 13、14 用这条一次性命令补，本次实跑：

```
$ node -e 'import("./js/core/solve.js").then((S)=>{for(let n=13;n<=14;n++){const t=S.buildTable(n,0);console.log(`n=${n} nodes=${t.size} reached=${t.reached} complete=${t.complete} BFS=${t.dist[(1<<n)-1]} formula=${S.formula(n)} maxDist=${t.maxDist}`)}})'
n=13 nodes=8192 reached=8192 complete=true BFS=5461 formula=5461 maxDist=8191
n=14 nodes=16384 reached=16384 complete=true BFS=10922 formula=10922 maxDist=16383
```

5461 与 10922 正是主代理手算表（1,2,5,10,21,42,85,170,341,682,1365,2730,5461,10922）的第 13、14 项；`buildTable` 的 n ≤ 16 上界允许这么跑（`js/core/solve.js:40`）。**这条不在 CI 里**（8192/16384 结点的两次建图会把 node 层从亚秒拖到秒级，且它是同一条主张的延伸而非新面），要长期钉住就往 `test/formula.test.mjs` 的 PUBLISHED 里加两行——本次交付没有动 `test/`（只登记，不扩测）。

---

## 5. 验收结论（真跑出来的输出行）

### 5.1 `npm run check`

```
$ npm run check

> nine-rings@1.0.0 check
> for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" || exit 1; done && echo OK

OK
rc=0
```

### 5.2 `node --test test/`

```
$ node --test test/
rows: 6 fail: 0
✔ test/formula.test.mjs (111.249375ms)
rows: 12 fail: 0
✔ test/game.test.mjs (127.914292ms)
rows: 9 fail: 0
✔ test/library.test.mjs (118.54ms)
rows: 10 fail: 0
✔ test/make.test.mjs (116.249667ms)
rows: 15 fail: 0
✔ test/solve.test.mjs (127.311125ms)
rows: 10 fail: 0
✔ test/storage.test.mjs (122.983625ms)
ℹ tests 6
ℹ pass 6
ℹ fail 0
rc=0
```

**断言行数 = 6 + 12 + 9 + 10 + 15 + 10 = 62，fail = 0，文件数 = 6，rc = 0。**
两个口径要说清，别混：`node --test` 的 `ℹ tests 6` 数的是**文件**（每个套件自跑自 `process.exit`，对 node 的 TAP 层只算一个用例）；`rows: N` 才是 `tools/harness.mjs` 里的断言数，聚合命令：

```
$ node --test test/ | awk '/^rows:/{a+=$2; b+=$4} END{print "asserts="a" fail="b}'
```

### 5.3 `SKIP_UNIT=1 bash tools/verify.sh`

这台机器同时只跑一个 headless Chrome，所以本次**只跑了一次**（先确认无其它 `--remote-debugging-port` 进程才起）。原文：

```
$ SKIP_UNIT=1 bash tools/verify.sh
=== node suites ===
opened http://127.0.0.1:5181/
(no console output)
boot level: novice-01
=== @boot ===
rows: 17 fail: []
=== @play ===
rows: 17 fail: []
=== @routes ===
rows: 17 fail: []
=== @save ===
rows: 13 fail: []
=== @reloaded ===
rows: 6 fail: []
=== @pointer ===
rows: 24 fail: []
=== console ===
(none)
=== ALL GREEN ===
rc=0
```

浏览器层合计 **94 条断言、fail 0、六段齐、console 干净**。`@pointer` 那 24 条是 Node 侧真实 `Input.dispatchMouseEvent`（坐标来自页面里的 `window.rings.ringPoint(k)`），其中包括把 `novice-02`（`js/data/levels.js:11`，`state 13 / par 9`）从头点到 `done: true` 的一条完整认证路线："the mouse taps the whole certified route, one move per tap"、"the sword is empty and the level is won"、"the win card goes up with three stars"、"an illegal tap is refused: no step, no distance change"、"a tap on bare board is ignored: no move and no refusal"、"undo takes the step back and the picture back with it"。

跑完后核查自己起的进程（无残留）：

```
$ pgrep -f "remote-debugging-port" | wc -l
0
$ lsof -nP -iTCP:5181 -iTCP:9341 -sTCP:LISTEN
（无输出：Chrome 与 5181 静态服务器都已退出）
```

`pgrep -f headless` 仍会列出两个**不属于本次运行**的进程：一个 `--print-to-pdf` 的文档转换 Chrome（起验证之前就已在，PID 58731）与 calibre 的 `--pipe-worker`。`tools/verify.sh:34-39` 的 `trap cleanup EXIT` 里对 Chrome PID 和 server PID 都做了 `kill -9` + `wait`，所以结尾没有 `Killed: 9` 噪音（原文里也没有）。

---

## 6. 未实现清单（诚实列）

按"缺什么"排序，不是"做完了什么"的换种说法。第 3、4、5、6 条是本次核查新发现的**文档/注释与实跑不一致**，
本任务禁止改其它文件所以先登记；第 3、4 条**随后由主代理修掉**（见改动表 #17/#18），第 5、6 条仍为未修。

1. **Electron 壳从未真实启动**。只有 `node --check electron/main.cjs`（在 §5.1 的 `npm run check` 里）过语法；仓内不装 electron、本机也没装，`README.md:130` 已声明。契约 §1 只要求复用 `server.cjs` + `port:0`（`electron/main.cjs:7-8` 确实如此），**运行性未验证**。
2. **移动端未真机验证**。`css/game.css` 的 ≤820px 断点与 `touch-action: none` 写了，`@pointer` 走的是鼠标事件（`Input.dispatchMouseEvent`），没有派发过 `Input.dispatchTouchEvent`。`README.md:131` 已声明。
3. **`README.md:23` 端口曾写错**（已修）：印的是 `# http://127.0.0.1:5180/`，实现默认 **5181**（`server.cjs:48,59`、`package.json:9` 的 `dev` 脚本、`verify.sh:16`、`playtest.mjs:18` 全是 5181）。见改动表 #17。
4. **`js/main.js:37` 注释曾指向不存在的节**（已修）："see DESIGN.md 1.3"；`DESIGN.md` 相关内容在 §1.1。见改动表 #18。
5. **计时数字不逐位可复现，文档未标注这一点**。本次实跑：`bake` 的 `0.0037 ms/level`、`balance` 的 `25 次完整 BFS 中位 0.056 · 最快 0.049 · 最慢 0.161`、`novice` 最慢 0.2072 ms。而 `README.md:63,80` 印的是 `中位 0.048 · 最快 0.046 · 最慢 0.170` 与 `中位 0.0013–0.0017 ms、最慢 0.5646 ms`，`js/core/library.js:11` 的注释印的是 `0.0025 ms each`。**结构量（512 / 341 / 511 / 四档区间 / 800-of-800）逐位可复现，计时量随机器与负载漂移**——文档把它们和结构量并列呈现，没写这一句区分。
6. **`README.md:49-54` 那张表混用了两个统计口径而未标注**：`关卡数 / par 中位` 来自**已发布 16 关**（`library.stats()`），`区间内位置数 / 剑上环数 min/med/max` 来自**整带 128/127 个位置**（`balance.mjs` 的"每一带的形状"段）。已发布池自己的剑上环数是 novice 1-6 / linked 2-7 / twined 3-9 / master 1-8（§4.2 的"各带剑上环数"行）。两栏都能用 `node test/balance.mjs` 复现，但同一行不同源。
7. **两处"导出但没人调用"（契约 §5 要求删掉，本仓没删干净）**：
   - `js/core/rng.js` 的 `rng.range`（`:26`）/ `rng.chance`（`:28`）/ `rng.shuffle`（`:29`）无任何调用方；被用到的是 `rng.int`（`js/core/make.js:61`）与 `rng.pick`（`:69,96`）。另外 `mulberry32` 只被同文件的 `rngFrom` 用（`:41-42`），不必导出。这是契约 §1（"rng.js 原样搬过去"）与 §5（"无人调用则删"）在这一格上的冲突，本仓按 §1 保留。
   - `window.rings.undoOnce`（`js/main.js:451`）在仓内**只有定义、没有调用方**：`grep -rn "undoOnce" js tools test` 只回 `js/main.js:451`。这是本次核查新查出的一条，比摘要里"unwired exports none"更严的口径。
   除这一格外，`window.rings` 的其余成员都被台架读到或调用（复现：`grep -oE "\bg\.[a-zA-Z]+\(" tools/playtest.mjs | sort -u` 列出 18 个方法调用，另有 `state/pool/bands/version/store` 以属性形式读）。**没有幽灵界面**：撤销能力本身有真断言（`@pointer` 的 "the u key undoes" 与 "undo takes the step back and the picture back with it"），没接线的只是 `undoOnce` 这个钩子别名。
8. **GitHub Actions 未在本机执行过**（无远端、无推送；本任务禁止 git 写操作）。`ci.yml` 的两个 step 与 `pages.yml` 的拷贝在本地各自等价于 §5.1 / §5.2 / §5.3 已跑绿的命令，但"CI 绿"这一声称要等主代理推上去才成立。
9. **n = 13、14 的闭式对账不在 CI 里**（§4.3 那条命令是手工一次性命令）。n = 15 及更大未跑（`buildTable` 上界 n ≤ 16，且 2^16 结点已不适合放在每次 CI 的 node 层）。
10. **18 环 / 24 环、"环数可调"滑块：刻意不做**，不是没做完。理由与失效边界写在 `DESIGN.md` §8 与 `README.md:123-126`：本仓整套"数字是证明值"的主张成立条件就是 512 能在 boot 时穷尽。已发布关卡行允许 `n ≤ 12`（`js/core/library.js:37`），但 shipped 的 64 行全是 `n = 9`（§4.1 的 `wrote 64 levels` 与 `js/data/levels.js` 64 行）。
11. **运营功能按禁令一律没做**：无成就/排行榜/签到/云存档/分享战绩、无音效彩带、无网络请求、无图片字体资源。分享只有 `#/lot/<id>`（谜题本身）。这不是缺口，是契约 §5 的边界，列在这里为了让接手的人别误以为"漏了"。

### 规格符合性（对照 `/tmp/puzzle-brief/nine-rings.md`）

| 规格条 | 要求 | 实测 |
|---|---|---|
| §1 规则 | `canToggle` 独立成函数并被正/负例夹击；k=1 不特判 | 达成（`js/core/game.js:36`；改动表 #1/#2） |
| §2 求解 | boot 跑 512 结点 BFS，断言结点数 === 512、耗时 < 20ms | 达成（`test/solve.test.mjs` 的 `ms < 20` + `@boot` 的 `gr.buildMs < 20`） |
| §2 对账 | n = 1..12 闭式对账 | 达成（`test/formula.test.mjs`），并额外手工补到 n = 13、14（§4.3） |
| §2 直径 | "n=9 时 `max(dist)` 必须是 341" | **规格为假**：`max(dist) = 511`，341 是 `dist[全1]`。两条都断言（改动表 #4） |
| §3 难度带 | 取 512 态直方图分位数，"预期 1–7 / 8–31 / 32–127 / 128–341" | 前一半达成（确实取分位数），后一半**规格为假**：实测 1-128 / 129-256 / 257-383 / 384-511（改动表 #5） |
| §3 每日题 | `hashSeed(YYYY-MM-DD)` 选带选掩码，跨设备一致 | 达成（`js/core/library.js:102-106`；`@routes` "the daily route is the same puzzle twice"） |
| §4 UI | 剑 + 9 环、环在两行之间真的位移、`ringPoint(k)` 给 CDP、可动环高亮 / 不可动灰+抖、面板含步数/par/超出/四档/分享/每日/重置/提示 | 达成；面板字段见 `js/main.js:119-124`（步数/最少/距最优/超出/最佳/剑上），`ringPoint` 见 `js/view.js:340`；证据是 §5.3 的 `@pointer`(24) |
| §5 node ≥ 38 | — | 62（§5.2） |
| §5 browser ≥ 38，含真实输入事件段 | — | 94，其中 `@pointer` 24（§5.3） |
| §7 9 环是设计边界 | 文档写死 | 写在 `DESIGN.md` §8、`README.md` 已知边界 |

---

## 8. 线上验收（GitHub Pages，主代理 2026-09-27 实抓）

本机 `tools/verify.sh` 跑的是 `server.cjs`；这一段证明**部署产物本身**也能跑（模块路径、MIME、hash 路由在
GitHub Pages 下同样成立），并且不是"测试全绿但画面是坏的"。

```
https://z-biz-game.github.io/z-biz-game-nine-rings-cos/                 200  2954 B（含"九连环" 3 处）
  js/main.js 200 16685 · js/core/solve.js 200 6823 · css/game.css 200 6864 · js/data/levels.js 200 7001
#/lot/novice-01 下页面状态（浏览器内取到的真实值）：
  window.rings = object，24 个键
  canvas 1384×970（不是未初始化的 300×150）
  画布像素抽样：74 个不同颜色、1258 个非黑采样 ⇒ 环与剑真的被画出来了
  console 消息：（none）
  面板文案含"关卡 novice-01 初摘 1-128 步 / 穷尽 512 态 / 剑上 1 共 9 环"
```

CI：`gh` 不可用，用 `status.sh` 查 API —— 最新 commit `success`，Pages `build_type: workflow` 已启用。
未抓的两项留作已知缺口：**没有像素级截图**（本机当且仅当只允许一个 headless Chrome，抓取时段被别的仓占着，
故改用上面的画布抽样代替）；**移动端未真机验证**（§6-2）。
