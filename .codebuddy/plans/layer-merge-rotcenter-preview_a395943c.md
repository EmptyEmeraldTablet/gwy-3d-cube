---
name: layer-merge-rotcenter-preview
overview: 三个独立功能整合实现：(1) 图层向下合并——活动层合并到下一图层，同位置顶层优先保留、丢弃被覆盖立方体6面，接入撤销/重做与资源释放；(2) 旋转中心可视化——临时参考标记（AxesHelper），支持拾取立方体/几何中心/手动输入/重置原点四种设定，旋转行为不变；(3) 操作预览——悬停平移/旋转/贴面堆叠按钮时以橙色线框轮廓显示目标效果，移开取消、点击提交。复用现有 layerMath 变换与 History 机制。
todos:
  - id: infra-layermath-viewer
    content: layerMath 加 layerPointToWorld；Viewer 加 centerMarker 与 previewGroup(showPreviewCubes/clearPreview)
    status: completed
  - id: ui-panel-toolbar
    content: LayerPanel/Toolbar 扩展 actions/state，加旋转中心控件、合并按钮、悬停预览回调
    status: completed
  - id: main-center-preview
    content: main.ts 实现旋转中心4种设定、3种悬停预览、标记同步与拾取拦截
    status: completed
    dependencies:
      - infra-layermath-viewer
      - ui-panel-toolbar
  - id: main-merge-down
    content: main.ts 实现 mergeDown 合并算法与 History Command
    status: completed
    dependencies:
      - ui-panel-toolbar
  - id: verify-typecheck
    content: 运行 tsc --noEmit 与 read_lints 校验类型与规范
    status: completed
    dependencies:
      - main-center-preview
      - main-merge-down
---

## 产品概述

为三维立方体编辑工具新增三个图层操作功能：图层向下合并、可调旋转中心可视化标记、操作悬停预览。三者均在现有图层面板/工具栏中接入，沿用现有撤销/重做与按需渲染机制，无新增依赖。

## 核心功能

### 一、图层向下合并

- 在活动层变换控制台新增"向下合并到下一图层"按钮；活动层为列表末层时禁用。
- 把当前活动图层合并到列表紧随其后的下一图层：活动层每个立方体的世界位置/旋转经反算映射到下一图层本地 gridPos 与 rotation（90°整数倍，无浮点漂移），归入下一图层后删除活动层。
- 位置冲突按"顶层优先"行业规范：合并后若活动层立方体与下一图层原有立方体落在同一世界网格位置，保留活动层（列表更靠前）立方体的完整6面绘制内容，丢弃下一图层同位置立方体（6面直接丢弃）。
- 接入 History 命令栈支持 undo/redo，历史裁剪时释放被丢弃立方体 GPU 资源。

### 二、旋转中心可视化标记

- 临时参考标记（坐标轴，穿透立方体可见），不持久化、不随场景保存；现有旋转操作行为不变（仍绕图层本地原点）。
- 四种设定方式：拾取场景中某立方体以其本地 gridPos 为中心；一键取该图层立方体几何中心（包围盒中心吸附整数格）；手动输入 X/Y/Z 整数网格坐标；一键重置到图层本地原点 (0,0,0)。
- 图层平移/旋转/切层/加载场景后自动同步标记世界位置；中心变更可撤销。

### 三、操作悬停预览

- 悬停操作按钮即预览（线框轮廓勾出目标边界），鼠标移开取消，点击按钮才真正提交。
- 覆盖平移、旋转、贴面堆叠三个操作；视觉形式为橙色线框（EdgesGeometry），区别于选中蓝色高亮，不参与拾取。

## Tech Stack

沿用现有项目栈：TypeScript + Three.js + 原生 DOM，无新增依赖。

## Implementation Approach

### 功能一·图层向下合并（向下合并 + 顶层优先）

活动层 `active=layers[idx]`，下一层 `below=layers[idx+1]`（无则 return）：

1. 收集 activeCubes / belowCubes。
2. 坐标转换（复用 layerMath 既有工具）：对每个 active cube，`w=worldTransform(cube,active)`；`localPos=worldToLocal(w.pos,below)`；`localRot=composeRotation(invertRotation(below.rotation), w.rotation)`；记录 orig{layerId,gridPos,rotation} 快照供 undo。
3. 顶层优先冲突检测：`activeKeys=Set(localPos key)`；`discarded=belowCubes.filter(c=>activeKeys.has(key(c.gridPos)))`。位置判定仅按 gridPos（不论旋转），保留 active 立方体旋转与6面。
4. redo：active cube 设 layerId=below.id/gridPos=localPos/rotation=localRot 并 syncCube；unregister 每个 discarded；layers.splice(idx,1) 删 active；setActiveLayer(below.id)；applyLayerOrders；layerPanel.refresh。
5. undo：还原 active cube orig 并 syncCube；register 每个 discarded；layers.splice(idx,0,active) 插回原位；setActiveLayer(active.id)；applyLayerOrders；layerPanel.refresh。
6. dispose：discarded 若 `!mesh.parent` 则 disposeCube（同 deleteLayer 模式）。

- 幂等 redo：依赖捕获的 transformed（含预计算 localPos/localRot/orig）与 discarded 引用，redo 前 undo 已还原 cube 状态，重跑安全。

### 功能二·旋转中心标记

- **Viewer**：`centerMarker: THREE.AxesHelper(0.6)`，renderOrder=999，material depthTest=false（穿透可见），默认隐藏；`setCenterMarkerWorld(pos)`/`setCenterMarkerVisible(v)`。
- **layerMath 新增** `layerPointToWorld(local,layer): GridPos = rotateGridPos(layer.rotation,local)+layer.pos`（功能三贴面预览也复用）。
- **main.ts 状态**（不序列化）：`rotationCenterByLayer: Map<string,GridPos>`（缺省{0,0,0}）；`pickingCenter: boolean`。
- **updateCenterMarker()**：活动层+中心 → layerPointToWorld → *SIZE → setCenterMarkerWorld；调用时机：setActiveLayer/syncLayer/translateLayer/rotateLayer/四种设定后/loadScene 后，且在状态变化或提交操作前先 clearPreview 再更新。
- **四种设定**（layerActions）：setRotationCenter(pos) 写Map+更新+入历史(轻量Command{layerId,oldCenter,newCenter})；pickRotationCenter() 置 pickingCenter=true+crosshair 光标；centerToGeometry() 求 min/max 包围盒中心取整；resetRotationCenter() 设{0,0,0}。
- **拾取落地**：pointerup 开头拦截 `if(pickingCenter){...命中立方体则以其 gridPos 设中心、退出模式、不 select; return;}`。

### 功能三·操作悬停预览（线框）

- **Viewer 预览支持**：`previewGroup: THREE.Group`（默认隐藏）；共享 `previewEdges=new EdgesGeometry(new BoxGeometry(SIZE,SIZE,SIZE))` 与 `previewLineMat=new LineBasicMaterial({color:0xffaa00})`（橙色）；`showPreviewCubes(items:{pos:Vector3,rot:Euler}[])` 为每个 item 建 LineSegments 加入 group；`clearPreview()` 清空并隐藏。线框不参与拾取。
- **三种预览计算**（main.ts，悬停时调用，不修改状态）：

1. 平移预览 `previewTranslate(axis,delta)`：previewPos={...layer.pos,[axis]:layer.pos[axis]+delta}；该层每个 cube 的 worldGrid=rotateGridPos(layer.rotation,cube.gridPos)+previewPos，worldRot=composeRotation(layer.rotation,cube.rotation)。
2. 旋转预览 `previewRotate(axis,delta)`：previewRot=normRotation({...layer.rotation,[axis]:layer.rotation[axis]+delta})；worldGrid=rotateGridPos(previewRot,cube.gridPos)+layer.pos，worldRot=composeRotation(previewRot,cube.rotation)。
3. 贴面预览 `previewAttach()`：复刻 attachStack 前几步（w=worldTransform(selected,srcLayer); n=attachGridPos(w.rotation,selectedFace); worldAdj=w.pos+n; local=attachInLayer(worldAdj,active)），预览立方体 worldGrid=layerPointToWorld(local,active)，worldRot=active.rotation（新立方体默认 rotation 0）。
4. cancelPreview()：viewer.clearPreview()。

- **UI 悬停接入**：LayerPanel 的 translateLayer/rotateLayer 每个 ± 按钮加 mouseenter→previewTranslate/previewRotate、mouseleave→cancelPreview；Toolbar 的 attachStack 按钮加 mouseenter→previewAttach（仅当有选中）、mouseleave→cancelPreview。扩展 btn/button 工厂支持可选 onEnter/onLeave 回调。
- **状态变化清理**：setActiveLayer、select/deselect、syncLayer、loadScene、任何提交操作前调 cancelPreview()，避免错位线框残留。

### 关键技术决策

- 旋转中心为临时参数不入 Layer 数据结构：避免改动 worldTransform/序列化的大面积影响，符合"旋转行为不变"确认；标记仅作可视化参考。
- layerPointToWorld 集中到 layerMath：避免 main 直接依赖 rotateGridPos，保持数学层内聚，功能二/三共用。
- 预览用共享 EdgesGeometry/LineBasicMaterial：clear 时不 dispose（长期复用），无 GPU 泄漏；线框不加入 picker.cubes 不影响拾取。
- 合并坐标变换经 layerMath 90°规整：undo/redo 与预览反复触发无浮点漂移。

## Implementation Notes

- **import 补充**：main.ts:15 当前仅 `import { worldTransform }`，需补 `worldToLocal, composeRotation, invertRotation, layerPointToWorld, rotateGridPos`。
- **按钮禁用**：活动层为末层时 mergeDown return + 按钮 disabled；需将 layer 在列表 index 传入 renderTransform（当前签名仅接收 layer）。LayerPanelState 新增 activeIndex。
- **向后兼容**：旋转中心不写入 SerializedScene/SerializedLayer；旧场景文件无相关字段，loadScene 后 Map 清空、标记重置到活动层原点。
- **状态清理时机**：预览线框在切层/选中变化/提交操作前必须 clearPreview；旋转中心标记在切层/变换后必须 updateCenterMarker。两者调用点需协同，避免残留。
- **性能**：合并 O(N) 一次性；标记/预览移动仅 set position/group + requestRender，静止零开销（按需渲染）；悬停预览 O(N)（N=层立方体数）可接受；按钮 disabled 时不预览。
- **GPU 资源**：合并不创建/释放 active cube 资源；discarded 由 History.dispose 裁剪释放；预览线框共享 geometry/material 长期复用不 dispose，无泄漏。

## Architecture Design

无新增架构模式，复用现有三层：

- **UI 层**（LayerPanel/Toolbar）：新增按钮/控件 + actions/state 接口项 + 悬停回调，事件回传 main.ts。
- **业务层**（main.ts layerActions/toolbar actions）：实现合并算法 + 中心设定 + 3种预览 + History Command，复用 syncCube/register/unregister/applyLayerOrders/setActiveLayer。
- **数学/渲染层**（layerMath/Viewer）：layerMath 新增 layerPointToWorld；Viewer 新增 centerMarker 与 previewGroup。

## Directory Structure

```
src/
├── scene/
│   ├── Viewer.ts       # [MODIFY] centerMarker(AxesHelper,depthTest=false,renderOrder=999)+setCenterMarkerWorld/setCenterMarkerVisible；previewGroup+共享previewEdges/previewLineMat+showPreviewCubes/clearPreview；默认隐藏
│   └── layerMath.ts    # [MODIFY] 新增导出 layerPointToWorld(local,layer):GridPos = rotateGridPos(layer.rotation,local)+layer.pos
├── ui/
│   ├── LayerPanel.ts   # [MODIFY] actions加mergeDown/setRotationCenter/pickRotationCenter/centerToGeometry/resetRotationCenter/previewTranslate/previewRotate/cancelPreview；state加rotationCenter/activeIndex；btn扩展onEnter/onLeave；renderTransform加旋转中心组(3输入框+拾取/几何/重置)+向下合并按钮(末层禁用)+平移旋转±按钮mouseenter/mouseleave
│   └── Toolbar.ts      # [MODIFY] actions加previewAttach/cancelPreview；button扩展onEnter/onLeave；attachStack按钮加mouseenter/mouseleave
├── main.ts             # [MODIFY] 补import；rotationCenterByLayer+pickingCenter+updateCenterMarker；layerActions实现mergeDown/4种中心设定/3种预览+cancelPreview；pointerup拾取拦截；状态变化处clearPreview+updateCenterMarker
└── (types.ts/History.ts/CubeFactory.ts/serialize.ts/Picker.ts/Stacking.ts 无需改动)
```