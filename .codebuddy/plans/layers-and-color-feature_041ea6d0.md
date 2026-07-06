---
name: layers-and-color-feature
overview: 为 3D 立方体工具增加“空间图层”概念（多层、整层平移/旋转、层间可重叠）与“单色立方体”支持（纯色作底色、保留逐面 2D 绘制）。新增 Layer 数据模型与图层管理面板，重构立方体世界变换以叠加层变换，并扩展序列化与撤销。
design:
  architecture:
    framework: html
  styleKeywords:
    - Glassmorphism
    - Dark Mode
    - Neon Accent
    - Compact Panel
    - Micro-animation
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 18px
      weight: 600
    subheading:
      size: 14px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#4a7dff"
      - "#5fb0ff"
    background:
      - "#1a1d23"
      - "#22262e"
      - "#2b303a"
    text:
      - "#e8edf6"
      - "#aab4c5"
    functional:
      - "#4a7dff"
      - "#ff5d6c"
      - "#37d39b"
      - "#ffce5a"
todos:
  - id: extend-types
    content: 在 types.ts 新增 Layer、Cube.layerId/color、SceneModel.layers，定义 SerializedLayer
    status: completed
  - id: layer-math
    content: 新建 layerMath.ts 实现 composeRotation/rotateGridPos/worldTransform，供合成与反算
    status: completed
    dependencies:
      - extend-types
  - id: cube-factory
    content: 改造 CubeFactory：createCube 接 layerId/color，syncMeshTransform 叠加层变换，新增 setCubeColor/显隐不透明度
    status: completed
    dependencies:
      - layer-math
  - id: stacking-picker
    content: Stacking 改为基于世界旋转贴面并反算本地格；Picker 仅拾取可见层立方体
    status: completed
    dependencies:
      - layer-math
  - id: layer-panel
    content: 新建 LayerPanel.ts：层列表、增删/重命名/重排/显隐/不透明度、活动层整层平移旋转控件
    status: completed
    dependencies:
      - extend-types
  - id: toolbar-main
    content: Toolbar 增加单色控件；main.ts 维护 layers/activeLayer，接线层操作与颜色、重算 mesh、序列化增 layer+color
    status: completed
    dependencies:
      - cube-factory
      - layer-panel
  - id: serialize-history
    content: serialize.ts 增加 layer+color 并兼容旧文件；History 纳入层与颜色操作
    status: completed
    dependencies:
      - toolbar-main
  - id: verify-build
    content: 运行 tsc --noEmit 与 vite build，手动验证多层重叠/单色/撤销/保存读取
    status: completed
    dependencies:
      - serialize-history
---

## 用户需求

在现有 3D 立方体工具中引入“图层”概念并支持单色立方体，对标平面设计软件的图层能力。

## 产品概述

- 将场景中的立方体组织到多个“空间图层”中，每个图层拥有独立的整体变换（平移按整数格、旋转按 90° 倍数），不同图层的立方体允许在空间上重叠/穿插（仅视觉重叠，不做 CSG 合并）。
- 每个立方体支持统一表面色彩（整体单色作为底色），同时保留逐面 2D 绘制能力。

## 核心特性

- **图层管理**：新增/删除图层、选中活动图层、重命名图层、调整图层前后顺序、显示/隐藏图层、设置图层不透明度。
- **整层变换**：对活动图层执行整体平移（X/Y/Z 整数格步进）与整体旋转（X/Y/Z 轴 90° 步进），层内所有立方体同步跟随。
- **跨层相交**：不同图层立方体可占据同一空间并按实际世界位置渲染（含穿插），层内/层间重叠均允许，不做几何合并。
- **单色立方体**：为选中立方体设置统一底色（纯色作底色 + 保留逐面 2D 绘制），支持清除恢复默认灰底。
- **兼容与持久化**：旧版无图层场景自动归入默认图层；保存/读取包含图层元信息与立方体颜色；层与颜色操作纳入撤销/重做。

## 技术栈

- 沿用现有栈：TypeScript + Three.js + Vite，纯 DOM 构建 UI（无框架），命令式 History 撤销/重做。
- 不引入新依赖；图层变换复用项目既有的 90° 轴对齐约束与 `GridPos`/`Rotation` 类型。

## 实现方案

核心思路：在扁平 `cubes` 列表上以 `layerId` 关联图层（`Layer` 持有自身变换），渲染时把“图层变换 ∘ 立方体本地变换”合成为世界变换再写入 `Mesh`。因图层与立方体旋转均为 90° 倍数，合成结果仍轴对齐，现有 `worldNormal`/`attachGridPos` 逻辑可继续复用（传入世界旋转）。

关键决策：

1. **数据组织**：`cubes` 保持扁平（引用 `layerId`），而非嵌套在 `Layer` 内——拾取、序列化、遍历成本最低，且与现有 `Picker`/`serialize` 改动最小。
2. **世界变换合成**：`worldPos = rotateGridPos(layer.rotation, cube.gridPos) + layer.pos`；`worldRotation = composeRotation(layer.rotation, cube.rotation)`。均为整数/90° 结果，无浮点漂移。
3. **单色实现**：`Cube.color?` 存 hex；`setCubeColor` 把 6 面 `material.color` 设为该色（清除时 0xffffff），并把面 canvas 底色填白以呈现纯净纯色（既有绘制笔迹保留为叠加层），逐面 2D 绘制/展开逻辑不变。
4. **相交与透明**：仅允许视觉重叠；隐藏层 `mesh.visible=false` 且不被拾取；不透明度通过 `material.transparent+opacity` 与按图层顺序设置的 `mesh.renderOrder` 控制绘制次序。
5. **撤销范围**：图层增删/重命名/重排/变换/显隐/不透明度与立方体改色均包装为 History 命令，沿用现有 `push({undo,redo})` 模式。

## 性能与可靠性

- 层变换仅重算该层内立方体（`O(该层立方体数)`），不影响其他层；渲染开销不变（仍是 N 个 Mesh）。
- 拾取按可见层过滤，零额外渲染成本。
- 90° 整数运算保证可重现、可序列化，无浮点累积误差。
- 向后兼容：旧 `.json` 无 `layers` 时包裹为默认图层，避免读取崩溃。

## 实现注意事项

- `syncMeshTransform(cube, layer)` 需同时处理“无图层（旧数据/默认层）”与“有图层”两种路径，旧调用点保持可运行。
- 层变换后必须同步更新该层 `mesh.renderOrder` 与 `mesh.visible`，并在隐藏层时通知 `Picker` 跳过。
- `attachGridPos` 改为基于立方体“世界旋转”计算相邻格，再反算目标立方体在活动层内的本地 `gridPos`（逆图层旋转）。
- 序列化写入/读取需补全 `layerId`/`color` 与 `layers` 数组，并做缺省兜底。

## 架构设计

```mermaid
graph TD
  L[Layer: id,name,pos,rotation,visible,opacity] -->|整体变换| C[Cube: gridPos,rotation,color,layerId]
  C --> M[THREE.Mesh]
  subgraph 世界变换合成
    WP[worldPos = rotateGridPos(layer.rotation, cube.gridPos) + layer.pos]
    WR[worldRotation = composeRotation(layer.rotation, cube.rotation)]
  end
  L -.世界变换.-> WP
  L -.世界变换.-> WR
  WP --> M
  WR --> M
  P[Picker] -->|仅可见层| M
  LP[LayerPanel] -->|增删/重排/显隐/不透明度/平移旋转| L
  TB[Toolbar] -->|setColor| C
```

## 目录结构

```
src/
├── model/
│   └── types.ts          # [MODIFY] 新增 Layer 接口；Cube 增加 layerId、color?；SceneModel 增加 layers、activeLayerId
├── scene/
│   ├── layerMath.ts      # [NEW] 纯函数：composeRotation / rotateGridPos / worldTransform / invertLayerRotation，供合成与反算使用
│   ├── CubeFactory.ts    # [MODIFY] createCube 支持 {color?,layerId?}；syncMeshTransform 叠加图层变换；新增 setCubeColor / applyLayerVisibilityOpacity
│   ├── Stacking.ts       # [MODIFY] attachGridPos 改为基于世界旋转，新增 attachInLayer 反算本地 gridPos
│   ├── Picker.ts         # [MODIFY] pick 仅返回可见层内立方体
│   └── Viewer.ts         # [MODIFY 轻微] 提供网格范围/渲染顺序辅助（可选）
├── ui/
│   ├── Toolbar.ts        # [MODIFY] 增加 setColor 动作与颜色选择控件；联动 LayerPanel
│   └── LayerPanel.ts     # [NEW] 图层面板：层列表、增删/重命名/重排/显隐/不透明度、活动层整层平移旋转控件
├── model/
│   └── serialize.ts      # [MODIFY] SerializedCube 增加 layerId/color；新增 SerializedLayer；场景读写兼容旧文件
└── main.ts               # [MODIFY] 维护 layers/activeLayerId；register/unregister 接层；层操作重算 mesh；接线颜色与面板
```

## 关键代码结构

```typescript
interface Layer {
  id: string;
  name: string;
  pos: GridPos;        // 整层平移（整数格）
  rotation: Rotation;  // 整层旋转（90° 倍数）
  visible: boolean;
  opacity: number;     // 0..1
}

interface Cube {
  id: string;
  gridPos: GridPos;
  size: number;
  rotation: Rotation;
  faces: Record<FaceId, Face>;
  mesh: THREE.Mesh;
  layerId: string;
  color?: string;      // 统一底色；undefined 表示使用默认逐面灰底
}

// 世界变换合成（layerMath.ts）
function worldTransform(cube: Cube, layer: Layer): { pos: GridPos; rotation: Rotation };
function composeRotation(a: Rotation, b: Rotation): Rotation;
function rotateGridPos(g: GridPos, r: Rotation): GridPos;
```

## 设计风格

沿用 3D 视口的暗色科技基调，图层面板采用玻璃拟态（Glassmorphism）悬浮于视口右侧，半透明深色面板 + 青蓝描边 + 微光，与现有场景背景（#1a1d23）和网格色（#4a7dff）协调统一，营造专业、精致的编辑工具质感。

## 页面与面板规划

本功能以“常驻右侧图层面板 + 顶部工具栏颜色控件”形式融入现有单页 3D 编辑器，不新增独立页面。

### 区块一：面板容器（顶部）

右侧固定悬浮面板，标题“图层”，右上角“+ 新增图层”按钮；面板半透明毛玻璃、圆角、柔和投影，宽度约 260px，顶部吸附视口。

### 区块二：图层列表（中部，核心）

竖向列表，每行代表一个图层：左侧拖拽/上下移箭头（调整前后顺序），名称文本（双击进入内联重命名输入），眼睛图标（显示/隐藏切换），不透明度滑块（0–100%），右侧删除按钮。当前活动层整行高亮（青蓝左边框 + 轻微底色），点击行任意处切换活动层。

### 区块三：活动层变换控制台（中下）

仅对活动层生效：三行平移控件（X/Y/Z 各“−”“+”步进按钮，显示当前整数格偏移）；三行旋转控件（绕 X/Y/Z 轴各“↺”“↻”90° 按钮，显示当前角度）。按钮采用紧凑方形玻璃按键，hover 发光。

### 区块四：选中立方体颜色（融入顶部工具栏）

在“编辑选中面”旁新增“单色”颜色输入（HTML color input + 清除按钮）。选中立方体时可用，改动即时刷新 6 面底色，保留逐面绘制。

### 区块五：提示与状态（底部）

面板底部一行极简提示：活动层名与立方体数；隐藏/透明状态以图标弱提示，避免遮挡 3D 视图。

## 交互与响应式

- 面板内所有操作即时反映到 3D 视口（整层平移/旋转、显隐、不透明度、单色）。
- 图层行 hover 高亮、按钮 micro-animation（缩放/发光）；活动层切换有平滑底色过渡。
- 桌面优先布局，面板固定右侧不随轨道控制移动；窗口缩放时面板宽度保持、列表可滚动。