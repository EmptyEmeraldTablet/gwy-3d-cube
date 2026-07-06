---
name: layer-merge-down
overview: 新增"向下合并图层"功能：把当前活动图层合并到列表中紧随其后的下一图层，合并后活动图层删除、其立方体归入下一图层；同世界网格位置冲突时按"顶层优先"保留活动图层立方体、丢弃下一图层同位置立方体，被丢弃立方体的6面绘制内容直接丢弃。复用现有 layerMath 变换工具，接入 History 撤销/重做与资源释放。
todos:
  - id: layerpanel-merge-btn
    content: "LayerPanel: LayerPanelActions 新增 mergeDown；renderTransform 末尾加\"向下合并\"按钮，末层禁用，render 传入 active index"
    status: pending
  - id: main-merge-impl
    content: "main.ts: 补充 layerMath import；layerActions 实现 mergeDown 合并算法（坐标转换+顶层优先冲突丢弃）并接入 History Command"
    status: pending
    dependencies:
      - layerpanel-merge-btn
  - id: verify-typecheck
    content: 运行 tsc --noEmit 与 read_lints 校验类型与规范
    status: pending
    dependencies:
      - main-merge-impl
---

## 用户需求

为三维立方体编辑工具新增"图层向下合并"功能。

## 产品概述

当前项目支持多个空间图层（Layer），每个图层有独立的整层平移/旋转变换，不同图层允许在空间上重叠。用户希望提供类似 PS "向下合并图层"的操作：把当前活动图层合并到列表中紧随其后的下一图层，合并后活动图层被删除，其立方体全部归入下一图层并转换到该图层的本地坐标系。

## 核心功能

- **向下合并入口**：在图层面板的"活动层变换控制台"区域新增"向下合并到下一图层"按钮；当活动层是列表最后一层时按钮禁用。
- **坐标转换**：活动层每个立方体的世界位置/旋转，经反算映射到下一图层的本地 gridPos 与 rotation（90° 整数倍，无浮点漂移）。
- **位置冲突处理（行业规范·顶层优先）**：合并后若活动层立方体与下一图层原有立方体落在同一世界网格位置，保留活动层（列表更靠前=顶层）立方体的完整 6 面绘制内容，丢弃下一图层同位置立方体。
- **6 面绘制内容**：被丢弃立方体的 6 面贴图直接丢弃，不合并。
- **撤销/重做**：合并操作接入现有 History 命令栈，支持 undo/redo；历史裁剪时释放被丢弃立方体的 GPU 资源。

## 技术栈

沿用现有项目栈：TypeScript + Three.js + 原生 DOM，无新增依赖。

## 实现方案

### 合并算法（向下合并 + 顶层优先）

活动层 `active = layers[idx]`，下一层 `below = layers[idx+1]`：

1. **收集**：`activeCubes = cubes.filter(c => c.layerId === active.id)`，`belowCubes = cubes.filter(c => c.layerId === below.id)`。
2. **坐标转换**（复用 `layerMath` 既有工具，无需新增）：

- 对每个 active cube：`w = worldTransform(cube, active)` 得世界 `{pos, rotation}`。
- 转入 below 本地：`localPos = worldToLocal(w.pos, below)`，`localRot = composeRotation(invertRotation(below.rotation), w.rotation)`。
- 正确性：`composeRotation(below.rotation, localRot) === w.rotation`（below 旋转 ∘ 其逆 ∘ 世界旋转 = 世界旋转），坐标经刚体反变换保唯一性。

3. **冲突检测（顶层优先）**：`activeKeys = Set(activeCubes 转换后的 localPos key)`；`discarded = belowCubes.filter(c => activeKeys.has(key(c.gridPos)))`。位置判定仅按 gridPos（不论旋转，符合用户确认的"相同位置"语义）。保留 active 立方体的旋转与 6 面，丢弃 below 同位置立方体。
4. **应用（redo）**：active cube 的 `layerId=below.id`、`gridPos=localPos`、`rotation=localRot`，逐一 `syncCube`；对每个 discarded cube 调 `unregister`；`layers.splice(idx,1)` 删除 active；`setActiveLayer(below.id)`；`applyLayerOrders`；`layerPanel.refresh()`。
5. **撤销（undo）**：用预存快照 `orig{gridPos,rotation}` 还原每个 active cube 的原 layerId/gridPos/rotation 并 `syncCube`；对每个 discarded cube 调 `register` 恢复；`layers.splice(belowIndex, 0, active)` 插回原位（below 删除 active 后其 index 恰为原 idx）；`setActiveLayer(active.id)`；`applyLayerOrders`；`layerPanel.refresh()`。

### Command 设计

沿用 `deleteLayer`（main.ts:203-233）的 `undo/redo/dispose` 三段式模式：

- `dispose`：对 discarded cubes，当 `!cube.mesh.parent`（已不在场景、undo 不可恢复）时调 `disposeCube`，与既有释放策略一致，避免误释放正在使用的资源。

### 关键技术决策

- **幂等 redo**：redo 直接重跑 `doMerge` 闭包，依赖捕获的 `transformed`（含预计算的 localPos/localRot/orig 快照，值不变）与 `discarded` 引用（undo 已 register 回场景）。redo 时 cube 状态已被 undo 还原，重新应用转换安全。
- **位置 key**：局部辅助 `key(g: GridPos) = '${g.x},${g.y},${g.z}'`，无需导入 `sameGridPos`（Stacking 有但语义等价，局部更内聚）。
- **旋转安全**：所有变换经 `layerMath` 的 90° 规整（`normDeg` 取整），无浮点漂移，undo/redo 多次往返坐标稳定。

## 实现备注

- **import 补充**：`main.ts:15` 当前仅 `import { worldTransform }`，需补充 `worldToLocal, composeRotation, invertRotation`。
- **按钮禁用**：活动层为列表末层（`idx === layers.length - 1`）时 `mergeDown` 直接 `return`，按钮 `disabled`。需将 layer 在列表中的 index 传入 `renderTransform`（当前签名仅接收 `layer`）。
- **单层内 gridPos 唯一性假设**：正常流程（`freeGridPos`/`attachStack`）保证单层内 gridPos 唯一；`worldToLocal` 为刚体双射，active 内唯一 → 转换后 below 本地仍唯一，不会产生 active 内部自冲突，无需额外去重。
- **GPU 资源**：合并本身不创建/释放 active cube 资源（仅改 layerId/gridPos/rotation + syncCube）；discarded cube 资源由 History.dispose 在裁剪时释放，与 `deleteLayer` 完全一致，无新增泄漏面。
- **性能**：合并为一次性 O(N) 遍历（N=立方体数），无热路径影响；`syncCube` 触发按需重绘，静止后零渲染开销（沿用现有按需渲染）。

## 架构设计

无新增架构模式。复用现有分层：

- **UI 层**（`LayerPanel`）：仅新增按钮 + `mergeDown` action 接口项，事件回传 main.ts。
- **业务层**（`main.ts` `layerActions`）：实现合并算法 + History Command，复用 `syncCube`/`register`/`unregister`/`applyLayerOrders`/`setActiveLayer`。
- **数学层**（`layerMath`）：零改动，提供坐标变换工具。

## 目录结构

```
src/
├── ui/
│   └── LayerPanel.ts   # [MODIFY] LayerPanelActions 新增 mergeDown: ()=>void；renderTransform 末尾追加"向下合并"按钮（末层禁用）；render 传入 active 层 index
├── main.ts             # [MODIFY] 补充 import { worldToLocal, composeRotation, invertRotation }；layerActions 新增 mergeDown 实现（合并算法 + History Command undo/redo/dispose）
```

`layerMath.ts`、`History.ts`、`CubeFactory.ts`、`types.ts` 均无需改动（已有全部所需工具与释放机制）。