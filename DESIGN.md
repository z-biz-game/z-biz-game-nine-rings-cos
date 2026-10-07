# 设计文档 · 九连环

面向维护者的技术说明：为什么这样实现、哪些约束一破就出 bug、契约禁止的"点击时现场搜索"与本仓允许的
做法边界在哪、难度带的四个数字是哪一次实测产出的。玩法规则与关卡清单见 [README.md](README.md)，
真实存在且已验证的东西与改动表见 [deliverable.md](deliverable.md)。

---

## 1. 核心决策：整张状态图在 boot 时穷尽走完

`js/core/solve.js:39` 的 `buildTable(n, root)` 从"剑已空"这个位置出发做一次广度优先搜索，
遍历 `2^n` 个位置，产出六张表：

| 字段 | 含义 | 谁读它 |
| --- | --- | --- |
| `dist[state]` | 从这个位置到空剑的最少拨环次数 | 面板"最少/距最优"、关卡 `par`、提示的"还需 N 步" |
| `next[state]` | 最短路上的下一步该拨哪个环 | 提示、演示、`@pointer` 的认证路线 |
| `via[state]` / `parent[state]` | 是哪一步、从哪个位置到达这里 | 测试里重建路径 |
| `counts[d]` | 距离恰好为 `d` 的位置数（距离直方图） | 难度带（见第 3 节） |
| `degree` / `reached` / `complete` / `maxDist` | 图的形状与覆盖度 | 断言与文档里的每个"穷尽"声称 |

n = 9 时这是 512 个结点。于是 `dist[]` 是一个**数组下标**，屏幕上印的数字是查表结果。

### 1.1 为什么这不违反"禁止点击时无上限现场搜索"

契约那条规则禁的是**成本上界由玩家输入决定的搜索**：玩家点一下，程序开始搜，
搜多久、搜多少状态取决于局面有多大 —— 那种搜索必须要么有 `limit`（此时结果可能不完整，
`par` 从证明值降级为意见），要么没有上界（此时浏览器就是会卡）。标杆仓 Gridlock 正是这个处境：
它的状态数是"几百到六万"，`solve` 带着 `limit = 300000`，所以生成与复验只能放构建期。

本仓的搜索成本**不随任何玩家行为变化**，三条界限都是编译期常数：

1. 结点集合是固定的 `{0, …, 2^9 − 1}`。一次点击只能把一个位翻转，永远落在这 512 个里。
2. `buildTable` 的每一层循环都由 `size` 或 `n` 界定：出队至多 512 次，每次试 9 个环
   （`js/core/solve.js:55-67`）。没有递归、没有 `while (true)`、没有"再搜深一点"的参数。
3. 规则本身是纯算术（`canToggle`），没有回溯、没有剪枝、也就没有"某个局面特别慢"这种东西 ——
   图上每个位置的距离都由同一次遍历确定，最坏等于全部。

所以"要不要放到构建期"这个问题在这里不存在：boot 跑一次 BFS 的实测代价是
**25 次完整遍历中位 0.048 ms、最慢 0.170 ms**（`node test/balance.mjs` 第一段最后一行），
浏览器里那一次由 `@boot` 断言钉住（`that search ran at boot in well under a frame`，`buildMs < 20`）。

**这个前提会在哪里失效**：`buildTable` 的上界写死在 n ≤ 16（越界直接 `throw`，
不是钳制）。n 一旦到 18，结点是 262144 个；n = 24 是 16777216 个，那六张表加一条 BFS 队列
按每个结点 22 字节算就要 350 MB 以上 —— 那就变成"boot 时可能崩"。换句话说：本仓不是因为 BFS 快才允许在浏览器里搜，
是因为 **512 小到"快"这个判断不需要预算参数**。想加大环数，先回答"没有 `limit` 还能不能在
任何设备上跑完"，答案是否的话，就得接受 `par` 变成估值，而那是另一份设计。

同一区分在文档与断言里出现三处，改代码时别只改一处：`js/core/solve.js` 顶部注释、
`test/solve.test.mjs` "the exhaustive sweep really covers all 512 positions, and is fast"、
`@boot` 的 4 条图形状断言。

### 1.2 341 与 511 不是同一个数（规格在这里是错的）

`dist[]` 以"空剑"为根，所以：

- `dist[511]`（九环全在剑上）= **341** = `(2^10 − 1)/3`，这才是闭式公式量的是那个数；
  它是本仓 `twined-11` 这一关，也是"九连环要 341 步"这句流传话的出处。
- `max(dist)` = **511**，取在位置 `256`（0b100000000，只有第 9 环在剑上）。
  这才是"根到最远结点的距离"。

规格 §2 把两者合成了一句"直径：n=9 时 `max(dist)` 必须是 341"。按那句话写断言会得到一条红的测试，
或者更糟：有人为了让它绿而把根改成"全上"。本仓两条都断言、并且各说各的问题 ——
`test/solve.test.mjs` "a(9) = 511: the deepest single ring is the far end of the graph" 钉住 `max(dist)`，
`test/formula.test.mjs` "the eccentricity of the all-on position is 341, its diameter is not"
把 341 与 511 放在同一条断言里对照。要动这张表时，**先分清你在回答哪一个问题**。

图论上这张图的直径等于 `max eccentricity = 511`；因为图是一条路径（第 3 节），
两个端点就是 `0`（空剑）与 `256`，所以"直径"和"`dist` 的最大值"这里恰好相同。

---

## 2. 拨环规则：一条谓词，写错的三种方式

规则的自然语言陈述（`js/core/game.js:36` 是唯一的实现）：

> 环 1（`k = 0`）随时能拨。环 `k+1`（`k ≥ 1`）能拨，当且仅当**环 `k` 在剑上**，
> 并且**所有比环 `k` 更靠下的环（环 1 … `k−1`）都不在剑上**。

掩码写法（bit `k` = 环 `k+1` 是否在剑上）：

```js
canToggle(state, k, n) = k === 0 ? true
  : (bitAt(state, k - 1) === 1 && (state & ((1 << (k - 1)) - 1)) === 0)
```

这条规则容易写错，而且**错了不会崩、只会变笨**，所以三种错法都要有对应的钉：

| 错法 | 为什么看起来对 | 后果 | 现在的钉 |
| --- | --- | --- | --- |
| 把 `k === 1`（环 2）特判成"总能动"，与环 1 并列 | 玩具上手试两下确实"环 1、环 2 很自由"；这是一行"简化" | 图还是连通的、512 个位置还是全覆盖，但那是**另一个更简单的玩具**：全上→全下量出 **171** 而不是 341（恰好约一半） | `test/formula.test.mjs` "the k=1 special case that was got wrong is pinned down (341, not 171)" 把错的谓词抄进测试、跑同一次 BFS，断言它确实到 171、确实覆盖 512 个位置，因此"覆盖率检查"抓不到它 —— 只有绝对数字能抓 |
| 掩码下标 off-by-one：`state & ((1 << k) - 1)` | 只差一个括号 | 把"要求 bit `k−1` 为 1"的那位也算进"必须为 0"，两个条件互相矛盾，环 2 以上永远拨不动，游戏变成只有环 1 能动 | `test/game.test.mjs` 的正/负例夹击 + `test/solve.test.mjs` "the rule says no where the fixture says no" / "says yes where the fixture says yes" |
| 1-based 与 0-based 混用（"第 k 环"到底是谁） | UI 印"第 2 环"，位是 `k=1` | 提示亮错环、面板说错话，规则本身却还是对的，最难查 | `isOn(state, k)`（`js/core/game.js:23`）是画面与文案唯一能读"某环在不在剑上"的入口；`test/game.test.mjs` "no shipped shell or view re-derives the bit layout" 直接读 `js/main.js`/`js/view.js` 源码，出现 `>> k`、`& 1)`、`bitAt(` 即失败，并要求 `isOn(` 真的被用到 |

第三条钉是这一轮补的（原先 `js/main.js` 里有一处自己写 `(state >> k) & 1`、`js/view.js` 用了四处
`bitAt(...) === 1`）。要点在于：**位布局是 `game.js` 的知识，不是每个读者的知识**。
一旦 shell 里出现第二份位移，规则改了它不会跟着改，画面与文案就会安静地说谎。

一次点击的一切后果集中在 `js/core/game.js:86` 的 `click(game, k)`：被拒绝时**什么都不改**
（不计步、不动位置、不写 history），返回值 `false` 让视图只允许抖一下。
这条口径由 `test/game.test.mjs` "illegal clicks are free" 与 `@pointer` 的三条真实鼠标断言各钉一次
（一个证明 `click()` 对，一个证明**手指真的点得着那个环**）。

---

## 3. 难度带的四个数字来自哪一个测量

**一次测量**：`bandCuts(table(9), 4)`（`js/core/solve.js:140`）——
把 512 个位置的距离（`dist[s] > 0` 的那 511 个）排序，取 25% / 50% / 75% 分位作切点，
每段记下它的 `min`、`max` 和落在校区内的**位置数**。

```bash
node test/balance.mjs        # 第二段就是它：parts=2/3/4/5 各切法的实测结果
```

```
parts=4 | 1-128(128)  129-256(128)  257-383(127)  384-511(128)
n=9 每一格 | novice 1-128(128)  linked 129-256(128)  twined 257-383(127)  master 384-511(128)
```

这四个区间能这么整齐，是因为这张图**是一条路径**：

- 从任一位置出发，`canToggle` 允许的动作数只有 1 或 2（`degree` 实测 `1-2`）；
- 512 个位置全被一次 BFS 到达（`reached = 512`，`complete = true`）；
- 连通 + 最大度 2 + 无环（每个位置的 `dist` 唯一）⇒ 一条哈密顿路径，
  `dist[]` 同时就是这个路径上的序号。`test/formula.test.mjs` 最后一条断言用另一个独立实现
  （逆二进制反射 Gray code 的秩 `grey⁻¹`）逐位比对 512 个位置，全等。

于是距离直方图是**平的**：512 个不同距离、每个距离恰好一个位置（`counts` 的最大值 = 1）。
等分位数切下去自然得到等宽区间。

规格 §3 预估的 `1–7 / 8–31 / 32–127 / 128–341` 隐含的是"距离按 2 的幂堆积"，
那只会在图很"深而窄"（少数位置极深、多数位置极浅）时出现。这里不是：图是路径，所以直方图均匀。
**四个档名与区间因此全部来自上面那次实测**，`js/core/make.js:39` 的 `TIERS` 在模块加载时
由 `bandsFromHistogram()` 现算（不是抄的字面量），`tools/bake.mjs` 把它连同直方图一起
写进 `js/data/levels.js`（`HISTOGRAM`、`TIERS_META`），`test/library.test.mjs`
"the bands are the histogram, not a opinion about hardness" 与 "the bands on screen are the bands in
the file, and they do not overlap" 再比对一次。改了规则却忘了让这三处同步，测试会红 —— 这是设计意图。

还有第二个"实测 vs 期望"的区别要守住：`TIERS` 是**生成包络**（带里允许哪些 `par`），
`TIERS_META` 是**已发布关卡实际落成的 min/max**（`tools/bake.mjs:76` 从入库行里量）。
两者都写进产物、并排放着，UI 印的是后者。Gridlock 那仓就是在这一格上抄错过。

---

## 4. 出题：能生成是因为不用搜

一条关卡 = 一个九位掩码。`js/core/make.js:56` 的 `makeLevel(seed, tierKey)` 做两件事：
在带里抽一个距离，再取"拥有这个距离的那个位置"（`statesAtPar`，`js/core/make.js:47`）。
因为第 3 节那条路径性质，池子里每个距离**恰好有一个位置**，于是：

- 接受率恒为 100%，重试环不存在（实测每带 500 个种子 `500/500`，`node test/balance.mjs` 第三段）；
- 中位耗时 0.0013–0.0017 ms/关，最慢 0.5646 ms —— 这是"可以在浏览器里生成"的全部依据；
- `makeLevel` 里那个 `throw`（"band 广告了一个表里不存在的距离"）永远不会响，
  但它是"带必须由表证明非空"这句话的看守。

所以每日题与随机关卡是现场生成的，战役 64 关烤进 `js/data/levels.js`。
烤的目的不是省时间（bake 亚秒级），而是**给关卡一个稳定 id 用来分享**，
以及留下一份可 review、可 diff 的实测记录。`js/core/library.js:33` 的 `validateLevel`
对每一行独立复算：`par` 必须等于 `dist[state]`、必须落在带内、`state` 必须放得进 `n` 位、
`rings` 必须可能 —— 手改一个数字，`test/library.test.mjs` 与 `tools/bake.mjs` 各自会红一次。

确定性：`js/core/rng.js`（FNV-1a `hashSeed` + `mulberry32`，与 Gridlock 同一份）。
`#/daily` 用 `hashSeed('daily|YYYY-MM-DD')` 选带再选位；`#/random/<tier>/<token>` 的 token 就在 URL 里。
裸 `#/random/twined` 每次访问都不同且不可复现，所以 `js/main.js` 一旦 mint 出 token 就
`location.replace` 写回地址栏（`@routes` 有断言）。

---

## 5. 三层不许互相串

| 层 | 文件 | 可以知道 | 不许知道 |
| --- | --- | --- | --- |
| 规则 | `js/core/*.js` | 位掩码、规则、BFS、查表、存档结构 | `window`、`document`、canvas |
| 画面 | `js/view.js` | 像素、指针坐标、动画位移 | 任何合法性判断（只**问** `movable`/`isOn`） |
| 外壳 | `js/main.js` | 路由、DOM、存档写入、`window.rings` | 规则细节（不碰位） |

`js/core` 里出现 `window.`/`document.` 会让 `node --test` 直接瘫掉（`tools/verify.sh` 的 node 段就是
`node <每个 test/*.test.mjs>`，没有浏览器）。`js/core/storage.js` 是唯一豁免：它的全部工作就是
**守卫式**访问 `localStorage`。

`store` 的单调性是产品语义，不是实现细节（`js/core/storage.js:61`）：
`best` 只会变小、`unlocked` 只会变大、`perfect` 的定义是 `moves <= par && !hints`
（用提示打平不算完美）。清档是全仓唯一破坏性操作，所以做成两次点击，
并且 `reset()` 连内存缓存一起换掉（留一份陈旧缓存会比不清档更糟：屏幕说清了、纪录还会回来）。

---

## 6. 画面：把规则画对就是玩法教学

`js/view.js` 只有两行是"语义"的：`settle()`（`js/view.js:110`）把每个环的目标行设为 `isOn(state, k) ? 0 : 1`，
以及 `drop[k]` 向目标插值。理由写在文件头注释里：**在上的环必须穿在杆上、拨下来的环必须挂在杆下，
而且环要真的在两行之间移动** —— 玩家看的是这个位移才知道规则是什么。

一处非显然的实现：`canvas.getContext('2d', { willReadFrequently: true })`。
台架用 `getImageData` 回读像素来证明"合法点击改变画面、非法点击不改变"，
没有这个标志 Chrome 每次回读都会在 console 打一条 warning，而 `verify.sh` 有
"console 必须干净"的断言 ——  warning 会淹没真错误。

`ringPoint(k)`（`js/view.js:360`）返回**动画后的实际位置**（含 `on`/`ring`），
这是 `@pointer` 能派发真实点击的前提；它也顺带证明了文案与画面读的是同一个 `isOn`。

---

## 7. 验证台架

### 7.1 为什么是 CDP 而不是 Playwright

`package.json` 的 `dependencies` 与 `devDependencies` 都是 `{}`，这是刻意的：
这仓要进 Pages CI，多一个依赖就多一条供应链。Node 21+ 自带全局 `fetch` 与 `WebSocket`，
`tools/playtest.mjs` 用它们直讲 CDP（`open|nav|eval|tap|shot|logs`）就够覆盖注入、真实输入、截图、抓 console。

### 7.2 `@pointer` 为什么必须存在

页面内注入的断言可以证明 `click()` 与 `routeToZero()` 正确，**证明不了手指点得着环**。
`@pointer`（`tools/playtest.mjs:209`）跑在 Node 侧：坐标来自页面里的 `window.rings.ringPoint(k)`，
事件是 `Input.dispatchMouseEvent` 的 press/release（`mouseAt` 在 `tools/playtest.mjs:53`；`tapRingAt` 在 `tools/playtest.mjs:58`）。它断言：

- 非法环（被规则拒绝的那个）点下去不计步、不改距离、shell 说出"拨不动"、抖动衰减后画面逐像素回到原样；
- 合法环点一下计一步、只动那一环、随后画面确实变了；
- 空板任意处点击既不计步也不产生"拨不动"文案（先验证该点离所有环都够远 —— 否则"什么都没发生"
  会因为错误的原因成立：那个坐标根本没落进页面）；
- **整条认证路线（`novice-02`，par 9）用真鼠标点完**，剑空、★★★、卡片印"你的 9 步 · 穷尽最少 9 步"、
  纪录落在 9；
- 键盘 `u`/`h`/`r`/`d` 与面板按钮走同一条 `commit()`。

要在命令行上亲手复现一遍这张截图：`node tools/playtest.mjs tap 0`（`tools/playtest.mjs:138`），
它用的就是 `@pointer` 那套原语，注入的 JS 只负责报坐标。

### 7.3 导航之后等的是 shell，不是秒表

`Page.navigate` 之后调 `waitShell()`（`tools/playtest.mjs:116`）轮询 `window.rings.state.id`。
`tools/verify.sh` 也一样：先轮询 `/json/version` **和** web 根目录都活，再轮询 boot 关卡，
每段之后取结果用**花括号计数**从 console 里截 JSON（headless 会在同一行后面追加文本，
`JSON.parse(整行)` 是随机失败）。固定 sleep 在 localhost 够用、打线上就是假故障。

### 7.4 三段台架自身的坑（都是真故障，改的是台架不是期望值）

1. **模板字面量里的转义**：场景体是写在 `` ` ` `` 里的**页面源码**。正则里的斜杠必须写 `\\/`：
   单反斜杠会被模板吃掉，页面收到一个未闭合的正则字面量，整段 `@save` 在解析期就抛
   `SyntaxError: Invalid regular expression flags`，一条断言都没跑。
   教训记在 `tools/playtest.mjs:604` 的注释里，并有一条硬规矩：**场景体内不写反引号、不写单反斜杠斜杠**。
2. **陈旧的结果缓冲**：`nonav` 模式下六段共用同一个页面，上一段的 `window.__lastRows` 还在。
   某段抛在解析期时，聚合器会把**上一段的 rows** 打印成这一段的成绩（`@save` 曾报 `rows: 18`
   而它实际一条都没跑）。现在每段执行前先 `window.__lastRows = null`。
   这条比任何断言都重要：它防的是"坏掉的台架看起来是绿的"。
3. **`textContent` 里找 `<b>`**：三条断言写成 `/已通 <b>N<\/b>/` 去匹配 `.textContent`。
   `textContent` 按定义没有标记，所以无论屏幕印什么它都不可能为真。改成 `.innerHTML`，
   **期望字符串一个字没动**（屏幕上的数字当时就已经对，失败详情可以作证）。

`index.html` 里的 `<link rel="icon" href="data:,">` 属于同一类：没有它 favicon 404 会污染
"console 干净"这条断言，而它是个纯噪音。

### 7.5 不暂停 `visibilitychange`

headless Chrome 把自己报成 hidden。通关动画与胜利卡片由同一个 rAF 循环驱动，
一暂停测试就永远看不到通关，所以 `js/main.js` 显式不接这个事件。

---

## 8. 刻意不做的东西

- **不做 18 环 / 24 环，也不做"环数可调"滑块**。理由不是"算不动"，而是**这套主张的成立条件**：
  512 个结点让穷尽成为 boot 时的常数，因而 `par` 是证明值、提示不会错、生成不用搜。
  n = 18 是 262144 个位置（本仓 `buildTable` 的上界是 16，越界抛错而不是钳制），
  n = 24 是 16777216 个，只算六张表就要 384 MB。一旦需要 `limit`，`par` 就从事实变成意见，
  本 README/DESIGN 里每一句"量出来的"都要重写。
- **不做浏览器内的"重烤池子"**：`tools/bake.mjs` 是构建期工具，shipped 代码不 import 它。
- **不做成就 / 排行榜 / 签到 / 云存档 / 分享战绩**（组织 E 组禁令）。分享只有 `#/lot/<id>`，
  分享的是谜题本身，不含分数。
- **除自动演示以外不加运营功能**。"演示"是允许的，因为它走 `next[]`，是求解器的可视化而不是另一个引擎
  （`@play` 与 `@pointer` 都断言它不会比 par 更便宜）。
- **无图片 / 音频 / 字体 / 打包器 / npm 依赖**：剑与九个环全部由 `js/view.js` 程序绘制，
  二进制资产 0 个。
- **不做多环数并行的关卡模型**：`js/data/levels.js` 的行允许 `n ≤ 12`（为了公式对账时能引用小 n），
  但 shipped 的 64 行全是 n = 9，`library.js` 只挂 n = 9 那张表。

## 9. 实测出的边界

- `formula(n)` 用 `Number` 运算到 n = 51 才失真，本仓把公开范围钳在 `1 ≤ n ≤ 51`；
  对账钉到 **n = 1..12**（`test/formula.test.mjs` 里的 PUBLISHED 表是手抄的），
  n = 13、14 由 deliverable.md 里那条一次性命令补到（`buildTable` 的上界 n ≤ 16 允许这么做）。
- 距离最大的一关是 `master-16`（511 步，位置 `256`，剑上只有第 9 环）。它在 UI 里是合法关卡，
  但**没人会在手机上点完 511 下**；它的价值是让"距最优 N 步"这一列在高档位仍然说得通。
- `undo` 只退一步、`history` 不做上限：把 `master-16` 按 `next[]` 走完，
  `game.history` 存下 511 个 `{ring, from, to}`（序列化后 15,624 字节）。
  这是刻意接受的浪费，换来的是 `@pointer` 能断言"撤销连像素一起退回去"。
