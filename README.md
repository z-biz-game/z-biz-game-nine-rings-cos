# 九连环 · NINE RINGS

把九个环全部从剑上拨下来。中国传统智力玩具九连环的浏览器实现，它和纸面版本的关键区别只有一条：
**屏幕上每一个数字都是查表得来的，因为整张状态图（`2^9 = 512` 个位置）在游戏启动时被广度优先搜索穷尽走完了。**

九连环只有一个动作：拨一个环上剑或离剑。而它恰好是"一个位置只有一条最短路"的玩具——
512 个位置在这条规则下连成**一条路径**，所以"最少几步"不是估值、不是启发式，而是查一次数组。

- **谁算了屏幕上的每个数字**：`js/core/game.js` 只有一个合法性谓词 `canToggle`；
  `js/core/solve.js` 用它把 512 个位置做一次穷尽 BFS，产出 `dist[]`（最少拨环数）与 `next[]`（最优下一环）。
  面板上的"最少 N 步""距最优 M 步""超出 K 步"、提示亮起的环、演示走的路线、四档难度的区间，
  全部读这张表；关卡的 `par` 就是 `dist[state]`，由 `tools/bake.mjs` 量出来写进 `js/data/levels.js`，
  再由 `test/library.test.mjs` 在每次 CI 里逐关复算。搜索器不给自己打分：
  同一个数字与闭式公式 `(2^(n+1) − (n 奇 ? 1 : 2))/3` 在 n = 1..12 上对过账（`test/formula.test.mjs`）。
- 零依赖、零美术、零打包器：只有 `index.html` + `css/` + `js/`，浏览器加载的就是仓库里的文件。
- 64 关已烘焙并逐关复验，四档带互不重叠、且是从 512 态直方图取分位数切出来的。
- 战役 / 每日 / 随机 / 分享链接四种入口，同一个 id 或同一个 token 在任何设备上都是同一个局面。
- 本地存档（localStorage），无账号、无网络请求、可离线。

## 跑起来

```bash
node server.cjs            # http://127.0.0.1:5181/
npm run unit               # 六个 node 测试套件（62 条断言）
bash tools/verify.sh       # node 套件 + headless Chrome 真实鼠标点击验收（94 条断言）
node test/balance.mjs      # 难度表：状态空间、直方图分位、生成器实测、已发布池子
node tools/bake.mjs        # 重新出题并复验，写 js/data/levels.js（亚秒级，见下）
npx electron .             # 桌面壳（需先自行 npm i -D electron，本仓不装）
```

`server.cjs` 是零依赖静态服务器，存在的唯一理由是 ES module 需要一个 origin，`file://` 会被 CORS 挡掉。

## 玩

- 画面上横着一把剑，九个环穿在剑杆上或挂在杆下。挂着的环是"已离剑"。
- 点一个环 = 拨它一次（上剑 ↔ 离剑），计一步。**规则只有一条**：
  第 1 环随时能拨；第 k+1 环能拨，当且仅当第 k 环在剑上、且比第 k 环更靠下的环全部不在剑上。
  拨不动的环是灰的，点它只抖一下、不计步。
- 目标：把所有环都拨离剑（剑杆空）。面板实时印 `步数 / 最少 / 距最优 / 超出 / 最佳 / 剑上`。
- 提示（`h`）亮起 `next[state]`——穷尽搜索认为该动的那个环；撤销 `u`、重开 `r`、演示 `d`（走的是同一张表）。
- 打平"最少"= ★★★ 完美解环；超出 1–3 步 = ★★；更多 = ★。星级只对着量出来的数字算，不看感觉。

## 这张表是谁算的

```bash
node test/balance.mjs          # 下面每一行都是它的输出
```

| 档 | 关卡数 | 最少拨环数（实测区间） | par 中位 | 区间内位置数 | 剑上环数 min/med/max |
|---|---|---|---|---|---|
| 初摘 novice | 16 | 1–128 | 65 | 128 | 1 / 3 / 7 |
| 连环 linked | 16 | 129–256 | 193 | 128 | 1 / 4 / 8 |
| 缠枝 twined | 16 | 257–383 | 320 | 127 | 3 / 6 / 9 |
| 九转 master | 16 | 384–511 | 448 | 128 | 1 / 4 / 8 |

状态空间这一头同样是量出来的（`node test/balance.mjs` 的第一段）：

```
位置数 2^9 | 512         到达数 | 512        全部可达 | true
图形状 | 一条路径（度 1-2）   不同距离数 | 512   每个距离的位置数最多 | 1
全上→全下（搜索） | 341    全上→全下（闭式 (2^10-1)/3） | 341
最深的距离 | 511 @ 位置 256 (0b100000000)
25 次完整 BFS (ms) | 中位 0.048 · 最快 0.046 · 最慢 0.170
```

注意最后两行不是同一个数：**341 是"九个环全在剑上"这一特殊位置的距离**（闭式公式给的就是它），
**511 才是这张表的最大值**—— deepest 位置是"只有第 9 环在剑上"。规格里把这两个数混为一谈了，
本仓两个都断言（`test/formula.test.mjs` "the eccentricity of the all-on position is 341, its diameter is not"、
`test/solve.test.mjs` "a(9) = 511"），并在 DESIGN.md 第 1.2 节写清区别。

难度带的区间不是"感觉上 1–7 算简单"，而是**把 512 个状态的距离直方图按等分位数切四刀**：
因为图是一条路径、每个距离恰好一个位置，四等分的结果就是宽度近似相等的四段
（`parts=4 | 1-128(128)  129-256(128)  257-383(127)  384-511(128)`）。规格预估的 1–7 / 8–31 / 32–127 / 128–341
不成立——那要求直方图按 2 的幂堆积，而它实际上是平的。

## 为什么生成可以在浏览器里跑

规划类仓一般把生成锁在构建期，因为生成 = 搜索。这里不是：**关卡是一个九位的掩码，
难度 = 一次数组查表**，所以生成一条关卡的实测代价是每带 500 个种子全接受、
中位 0.0013–0.0017 ms、最慢 0.5646 ms（`node test/balance.mjs` 第三段）。
接受率恒为 100%，因为带内每个距离都由表证明存在位置，没有重试环。
所以每日题和随机关是现场生成的，而 64 关战役仍然烤进 `js/data/levels.js`——
烤它不是为了省时间，是为了**有稳定的 id 可以分享**（`#/lot/twined-11`）并留下一份可 review 的实测记录。

## 验收

`bash tools/verify.sh` 一条命令跑完两层：

- **node 层 62 条**：`formula`(6) 闭式对账与 171/341 反证、`game`(12) 规则与纯函数性、
  `library`(9) 逐关复算与负例、`make`(10) 分位带与生成器、`solve`(15) 穷尽覆盖与 `next[]` 回放、
  `storage`(10) 存档单调性与退化。
- **浏览器层 94 条**：`tools/playtest.mjs` 起一个真实 headless Chrome，
  `@boot`(17) 画布真的被排版并画出像素、`@play`(17) 通关/评星/提示/演示、`@routes`(17) 四种路由与钳制、
  `@save`(13) localStorage 落盘与两次点击清档、`@reloaded`(6) 重载后确实从磁盘读回、
  `@pointer`(24) **派发真实 `Input.dispatchMouseEvent`** 把一关（`novice-02`，par 9）从头点到通关，
  并断言非法点击不计数不改画面、空板点击被忽略、撤销连像素一起退回去。

## 文件地图

```
index.html            壳：顶栏 / 画布 / 右侧面板 / 通关卡（含 data: 的 favicon，防 404 污染 console）
css/game.css          全部样式，一个文件
js/core/game.js       规则：canToggle 是唯一合法性来源；click/undo/hint/route/grade（无 DOM）
js/core/solve.js      512 结点的穷尽 BFS：dist[] / next[] / 直方图 / 闭式公式 formula(n)
js/core/make.js       难度带（从直方图切）+ 确定性出题
js/core/library.js    查表：战役 64 关 / 每日 / 随机 / id + 行校验 + stats()
js/core/storage.js    localStorage 存档，无 window 或存储被拒时退化成内存
js/core/rng.js        FNV-1a 种子哈希 + mulberry32
js/data/levels.js     构建期产物：HISTOGRAM、TIERS_META、64 行带实测 par 的关卡
js/view.js            canvas 2D 绘制（剑 + 九个环的上下位移）+ 指针手势，不判合法性
js/main.js            路由、DOM、存档写入、window.rings 测试钩子
server.cjs            零依赖静态服务器
electron/main.cjs     桌面壳（复用同一个服务器）
tools/bake.mjs        出题 → 复验 → 写 js/data/levels.js，并打印实测直方图 / tools/assemble-site / tools/deploy-set / tools/deploy-set-selftest
tools/playtest.mjs    零依赖 CDP 驱动，真实鼠标键盘事件
tools/verify.sh       一次性验收门
tools/harness.mjs     微型测试框架，node 与浏览器套件输出形状一致
test/                 六个套件 + 手算 fixture + 难度台架 balance.mjs
```

## 已知边界

- **9 环是设计边界，不是难度设置**。整个仓的主张（每个数字都是穷尽证明值）依赖 512 这个数能被
  浏览器启动时算完。18 环是 262144 个位置、24 环是 1677 万，"点一下就有答案"就不再是查表而是搜索了。
  `buildTable` 允许 n ≤ 16 只服务于测试与公式对账，游戏本身只跑 n = 9（关卡行可声明 n ≤ 12，
  但距离与 n = 9 的表逐位相同，这条由 `test/solve.test.mjs` 量出来）。
- 缠枝/九转档在真手上是 257–511 次点击，没有人在手机上按得完；它们存在的意义是**印着一个可证数字**，
  以及让"距最优 N 步"在早期档里真的有意义。想玩就玩初摘档，或者 `#/random/novice/<token>`。
- 通关后没有彩带、没有音效、没有分享弹窗；分享只分享谜题本身（`#/lot/<id>`），不带战绩。
- Electron 壳过 `node --check`，但仓库不装 electron，**没有跑过真实启动**。
- 移动端断点（≤820px）已写、`touch-action: none` 已接，但**没有真机验证**。
- 多语言：UI 只有中文。

## License

MIT © 2026 z-biz-game

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高。
- **钉住两个数**：`EXPECT_CHECKS=28`（R 段实际检查的路径条数）与 `EXPECT_ROWS=46`
  （这一次跑的断言条数）。没改页面却掉了，说明解析断了；删掉一张图标会同时少一条 R10 与那张的
  P1/P2，所以两个数一起钉，rows 能漂就是闸在缩水的信号。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`28`、rows 仍然 `46`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑，所以页面改了、仓与仓不同，台架跟着走。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；把它们接进本仓
那条浏览器 one-shot（`tools/verify.sh`）还欠着——那道脚本的腿名单与条数钉是每个仓自己的形状。
