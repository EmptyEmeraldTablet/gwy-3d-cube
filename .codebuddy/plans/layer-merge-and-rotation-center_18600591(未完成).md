---
name: layer-merge-and-rotation-center
overview: 两个独立功能整合实现：(1) 图层向下合并——活动图层合并到下一图层，同位置按顶层优先保留、丢弃被覆盖立方体6面，接入撤销/重做与资源释放；(2) 旋转中心可视化——临时（不持久化）参考标记，支持拾取立方体/几何中心/手动输入/重置原点四种设定方式，旋转行为不变（中心仅作参考标记）。复用现有 layerMath 变换与 History 机制。
todos:
  - id: layermath-viewer-marker
    content: layerMath 新增 layerPointToWorld；Viewer 新增 centerMarker 与 setCenterMarkerWorld/setCenterMarkerVisible
    status: pending
  - id: layerpanel-ui
    content: LayerPanel 扩展 actions/state 接口，加旋转中心控件组与向下合并按钮(末层禁用)
    status: pending
  - id: main-rotation-center
    content: main.ts 实现旋转中心状态、四种设定、标记同步与 pointerup 拾取拦截
    status: pending
    dependencies:
      - layermath-viewer-marker
      - layerpanel-ui
  - id: main-merge-down
    content: main.ts 补 import 并实现 mergeDown 合并算法与 History Command
    status: pending
    dependencies:
      - layerpanel-ui
  - id: verify-typecheck
    content: 运行 tsc --noEmit 与 read_lints 校验类型与规范
    status: pending
    dependencies:
      - main-rotation-center
      - main-merge-down
---

## 产品概述

为三维立方体编辑工具新增两个图层操作功能：图层向下合并、可调旋转中心可视化标记。两者均在现有图层面板（活动层变换控制台）中接入，沿用现有撤销/重做与按需渲染机制。

## 核心功能

### 一、图层向下合并

- 在活动层变换控制台新增"向下合并到下一图层"按钮；活动层为列表末层时按钮禁用。
- 把当前活动图层合并到列表中紧随其后的下一图层：活动层每个立方体的世界位置/旋转经反算映射到下一图层的本地 gridPos 与 rotation（90°整数倍，无浮点漂移），归入下一图层后删除活动层。
- 位置冲突按"顶层优先"行业规范：合并后若活动层立方体与下一图层原有立方体落在同一世界网格位置，保留活动层（列表更靠前）立方体的完整6面绘制内容，丢弃下一图层同位置立方体。
- 被丢弃立方体的6面贴图直接丢弃；接入 History 命令栈支持 undo/redo，历史裁剪时释放被丢弃立方体的 GPU 资源。

### 二、旋转中心可视化标记

- 临时参考标记（坐标轴，穿透立方体可见），不持久化、不随场景保存；现有旋转操作行为不变（仍绕图层本地原点）。
- 四种设定方式：拾取场景中某立方体以其本地 gridPos 为中心；一键取该图层所有立方体几何中心（包围盒中心，自动吸附整数格）；手动输入 X/Y/Z 整数网格坐标；一键重置到图层本地原点 (0,0,0)。
- 图层平移/旋转/切层/加载场景后自动同步标记的世界位置；中心变更可撤销。

## Tech Stack

沿用现有项目栈：TypeScript + Three.js + 原生 DOM，无新增依赖。

## Implementation Approach

### 功能一·图层向下合并（向下合并 + 顶层优先）

活动层 `active = layers[idx]`，下一层 `below = layers[idx+1]`（无则 return）：

1. 收集 activeCubes / belowCubes。
2. 坐标转换（复用 layerMath 既有工具）：对每个 active cube，`w = worldTransform(cube, active)`；`localPos = worldToLocal(w.pos, below)`；`localRot = composeRotation(invertRotation(below.rotation), w.rotation)`；记录 orig{layerId, gridPos, rotation} 快照供 undo。
3. 顶层优先冲突检测：`activeKeys = Set(localPos key)`；`discarded = belowCubes.filter(c => activeKeys.has(key(c.gridPos)))`。位置判定仅按 gridPos（不论旋转），保留 active 立方体的旋转与6面。
4. redo：active cube 设 layerId=below.id / gridPos=localPos / rotation=localRot 并 syncCube；unregister 每个 discarded；layers.splice(idx,1) 删 active；setActiveLayer(below.id)；applyLayerOrders；layerPanel.refresh。
5. undo：还原 active cube 的 orig 并 syncCube；register 每个 discarded；layers.splice(idx,0,active) 插回原位；setActiveLayer(active.id)；applyLayerOrders；layerPanel.refresh。
6. dispose：discarded cubes 若 `!mesh.parent` 则 disposeCube（同 deleteLayer 模式）。

- 幂等 redo：依赖捕获的 transformed（含预计算 localPos/localRot/orig）与 discarded 引用，redo 前 undo 已还原 cube 状态，重跑安全。

### 功能二·旋转中心标记

- **标记对象**（Viewer.ts）：私有 `centerMarker: THREE.AxesHelper(0.6)`，renderOrder=999，material 设 depthTest=false（穿透可见），加入 scene；公开 `setCenterMarkerWorld(pos)` / `setCenterMarkerVisible(v)`；默认隐藏。
- **状态**（main.ts 模块级，不序列化）：`rotationCenterByLayer: Map<string, GridPos>`（每层临时中心，缺省 {0,0,0}）；`pickingCenter: boolean`。
- **世界位置同步**：layerMath 新增导出 `layerPointToWorld(local, layer): GridPos`（= rotateGridPos(layer.rotation, local) + layer.pos）；`updateCenterMarker()` 算世界坐标并更新标记可见性。调用时机：setActiveLayer、syncLayer、translateLayer、rotateLayer、四种设定后、loadScene 后。
- **四种设定**（layerActions）：setRotationCenter(pos) 写 Map+更新+入历史；pickRotationCenter() 置 pickingCenter=true+crosshair 光标；centerToGeometry() 求 min/max 包围盒中心取整；resetRotationCenter() 设 {0,0,0}。
- **拾取落地**：main.ts pointerup 开头拦截——若 pickingCenter，命中立方体则以其 gridPos 设中心、退出模式、不 select。
- **历史**：中心变更入 History，Command 仅记录 {layerId, oldCenter, newCenter}，轻量可撤销。

### 关键技术决策

- 旋转中心为临时参数不入 Layer 数据结构：避免改动 worldTransform/序列化的大面积影响，符合用户"旋转行为不变"的确认；标记仅作可视化参考。
- layerPointToWorld 集中到 layerMath：避免 main 直接依赖 rotateGridPos，保持数学层内聚。
- 标记用 AxesHelper 且不加入 picker.cubes：不参与拾取、不影响现有逻辑；depthTest=false 保证被立方体遮挡时仍可见。
- 合并坐标变换经 layerMath 90°规整：undo/redo 多次往返无浮点漂移。

## Implementation Notes

- **import 补充**：main.ts:15 当前仅 `import { worldTransform }`，需补 `worldToLocal, composeRotation, invertRotation, layerPointToWorld`。
- **按钮禁用**：活动层为末层时 mergeDown return + 按钮 disabled；需将 layer 在列表的 index 传入 renderTransform（当前签名仅接收 layer）。
- **向后兼容**：旋转中心不写入 SerializedScene/SerializedLayer；旧场景文件无相关字段，loadScene 后 Map 清空、标记重置到活动层原点。
- **截图**：takeScreenshot 会包含标记（参考标记可见符合"便于旋转操作"目标）；如需排除可截图前隐藏后恢复，作为可选优化。
- **性能**：合并为一次性 O(N) 遍历无热路径影响；标记移动仅 set position + requestRender，静止零开销（沿用按需渲染）。
- **GPU 资源**：合并不创建/释放 active cube 资源；discarded cube 资源由 History.dispose 裁剪时释放，与 deleteLayer 一致，无新增泄漏面。

## Architecture Design

无新增架构模式，复用现有三层：

- **UI 层**（LayerPanel）：新增按钮/控件 + actions/state 接口项，事件回传 main.ts。
- **业务层**（main.ts layerActions）：实现合并算法 + 中心设定 + History Command，复用 syncCube/register/unregister/applyLayerOrders/setActiveLayer。
- **数学/渲染层**（layerMath/Viewer）：layerMath 新增 layerPointToWorld；Viewer 新增 centerMarker。

## Directory Structure

```
src/
├── scene/
│   ├── Viewer.ts       # [MODIFY] 新增 centerMarker(AxesHelper,depthTest=false,renderOrder=999)+setCenterMarkerWorld/setCenterMarkerVisible；默认隐藏
│   └── layerMath.ts    # [MODIFY] 新增导出 layerPointToWorld(local,layer): GridPos = rotateGridPos(layer.rotation,local)+layer.pos
├── ui/
│   └── LayerPanel.ts   # [MODIFY] LayerPanelActions 新增 mergeDown/setRotationCenter/pickRotationCenter/centerToGeometry/resetRotationCenter；LayerPanelState 新增 rotationCenter；renderTransform 加"旋转中心"控件组(3输入框+拾取/几何/重置按钮)+"向下合并"按钮(末层禁用)；render 传入 active index
├── main.ts             # [MODIFY] 补 import；rotationCenterByLayer Map+pickingCenter 状态+updateCenterMarker；layerActions 实现 mergeDown 与4种中心设定；pointerup 拾取模式拦截；setActiveLayer/syncLayer/translateLayer/rotateLayer/loadScene 后更新标记
└── (types.ts/History.ts/CubeFactory.ts/serialize.ts/Picker.ts/Stacking.ts 无需改动)
```