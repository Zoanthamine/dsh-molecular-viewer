# Agent 与分子查看器联动 · 0.2.1

## 用户怎么说

- 「打开这个 Gaussian 日志的优化轨迹。」
- 「打开这个 ORCA 输出的最后一帧。」
- 「找最后一个有明确优化收敛标记的坐标帧，别把最后帧当成收敛帧。」
- 「从这个 FCHK 提取已有坐标到一个新 XYZ，再打开三维。」

不需要在对话里贴完整坐标。文件仍在本机；本插件不启动计算、不优化或加氢。

## 直接打开

```js
molecule_open({path: "existing.log", frame: "all", title: "优化轨迹"})
molecule_open({path: "existing.log", frame: "last-converged"})
molecule_open({path: "existing.inp", frame: "first"})
molecule_open({path: "existing.fchk", frame: "1"})
```

`frame` 为字符串：`all / first / last / last-converged / 1…N`，索引从 1 开始。`all` 默认显示首帧，同时保留全部帧供切换或播放。指定某帧也保留整条轨迹，不自动丢弃其他原始坐标块。

工具只返回 `queued`、路径、选择器和请求 ID，不返回原子坐标。只有当前会话 GUI 同源文件读取、解析并返回 `rendered: true` 后，才可确认真正显示；未登录、非活动会话、读取/格式错误都不能当作已显示。相对路径在排队时绑定到权威 cwd，之后切换工作目录不会改指向。

## 先检查或导出：使用已授权的宿主执行工具

随插件安装的脚本位于包内 `lib/extract-coordinates.mjs`。Agent 必须通过当前宿主批准的 Bash/其他文件操作流程运行，不得另开任意文件读写 HTTP 接口。脚本需要现有 Node 22+，无需安装 Gaussian、ORCA 或 RDKit。

```bash
node /ABSOLUTE/PLUGIN/lib/extract-coordinates.mjs --input /ABSOLUTE/INPUT.log --frame all
node /ABSOLUTE/PLUGIN/lib/extract-coordinates.mjs --input /ABSOLUTE/INPUT.log --frame last-converged --output /ABSOLUTE/NEW.xyz
node /ABSOLUTE/PLUGIN/lib/extract-coordinates.mjs --input /ABSOLUTE/INPUT.fchk --frame first --output /ABSOLUTE/NEW.xyz
```

摘要包含格式、帧/原子数、明确收敛标记的位置、源单位、存在时的电荷/多重度以及源/导出文件 SHA256；不含完整原子坐标数组。逐帧表最多 50 项，提示最多 20 项，避免再次撑大对话。

不指定 `--output` 只读检查；指定输出必须是尚不存在的 `.xyz`。拒绝源文件覆盖、既有输出、URL、UNC、链接/联接、非文本或超限文件。读前后核验文件稳定性。默认最多 32 MiB、10,000 原子/帧、500 帧、累计 100,000 原子坐标。

导出成功后对派生 XYZ 调用 `molecule_open({path: "NEW.xyz", frame: "all"})`。XYZ 保留元素、原子顺序、数值坐标和源哈希注释，但不保留键级、同位素或全部原子属性；其注释不被当作新的收敛证明，不能再凭 XYZ 自行使用 `last-converged`。

## 格式与证据边界

- Gaussian GJF/COM：明确笛卡尔输入；LOG/OUT：Input/Standard orientation 多帧；FCHK/FCH：严格校验 `Number of atoms`、`Atomic numbers` 与 `Current cartesian coordinates` 的 N/3N 关系，Bohr 换算为 Å。
- ORCA INP：`* xyz` 或 `%coords` 的明确坐标/单位；LOG/OUT/OUTPUT：明确 Å/A.U. 坐标表。`xyzfile` 引用不会被隐式读取，须单独提供实际坐标文件。
- Gaussian `Step number` 对应前一坐标块；ORCA `GEOMETRY OPTIMIZATION CYCLE` 才标注优化步。无明确步号时只称「坐标帧」。末帧、正常程序终止、SCF 收敛均不能替代明确几何优化收敛证据，更不证明极小值或 TS。
- 坐标轨迹可能含单位重复块或参考坐标系变化；不做对齐、内插或物理时间解释。播放仅顺序显示已有坐标。
- 不支持内部坐标、Ghost/dummy 扩展、多作业混排、二进制 CHK 的猜测转换或从真实 GIF 图片可靠还原坐标。`.gif` 若指 `.gjf` 笔误，使用 `.gjf`；确为动画时需另行提供原始结构坐标。

## Verification

Format-specific synthetic tests cover unit conversion, explicit convergence markers, atom order, XYZ round-trips, invalid inputs, and no-clobber export. Publication intentionally excludes real calculation inputs and personal validation records. A coordinate export is not a new optimization or proof of a minimum/transition state.
