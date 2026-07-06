---
name: quaternion-rotation-fix
overview: 用四元数（THREE.Quaternion，three 已内置无需新库）累加图层旋转，替换当前欧拉分量直接累加的做法，消除万向锁与旋转顺序不一致；同步修正 invertRotation 使其在多轴下为真逆变换。序列化仍用 Euler，向后兼容。
todos:
  - id: add-quat-helper
    content: 在 layerMath.ts 新增 rotateByAxis（四元数 world-frame 复合+吸附），并把 invertRotation 改为四元数逆
    status: completed
  - id: fix-rotate-layer
    content: main.ts 导入 rotateByAxis，改写 rotateLayer 第458行改用四元数复合（中心补偿保留）
    status: completed
    dependencies:
      - add-quat-helper
  - id: fix-preview-rotate
    content: main.ts 改写 previewRotate 第650行改用 rotateByAxis
    status: completed
    dependencies:
      - add-quat-helper
  - id: verify
    content: 运行 tsc --noEmit 与 lint，并复现多轴+旋转中心场景验证一致性
    status: completed
    dependencies:
      - fix-rotate-layer
      - fix-preview-rotate
---

## 用户需求

1. 排查并修复旋转相关的"万向锁"/旋转顺序不一致问题：当前对图层做多次不同轴向旋转后，再施加相同轴向旋转，几何体最终到达的位置会出现不一致（被正确情况应是可预测的、与操作顺序无关的稳定复合）。
2. 确认是否有可复用的现成库来累加四元数旋转。

## 核心结论（已确认）

- 库：项目已依赖 `three@^0.161.0`，内置 `THREE.Quaternion` / `THREE.Euler`，可直接用于四元数累加，**无需引入任何新依赖**。
- 根因：图层侧旋转 `rotateLayer` 与 `previewRotate` 仍用欧拉分量直接累加 `normRotation({...r,[axis]:r[axis]+delta})`，等价于"固定顺序欧拉分解下的分量增量"，并非真实旋转复合，导致顺序相关与万向锁；而立方体侧 `composeRotation`、`rotateWorldAxis` 已正确用四元数复合。
- 连带问题：`invertRotation` 仅简单取反三个分量，对多轴欧拉并非真正逆变换，会影响 `worldToLocal`（拾取/合并图层里把世界坐标反算回图层本地坐标）。

## 技术栈

- 现有栈：TypeScript + Three.js（`three@^0.161.0`，提供 `THREE.Quaternion`/`THREE.Euler`/`THREE.Matrix4`）。**四元数库已内置，零新增依赖**。
- 数据模型保持不变：`Layer.rotation` / `Cube.rotation` 仍为欧拉角 `{x,y,z}`（90° 倍数），用于存储、显示、序列化；旧存档加载后首次旋转会自然吸附，向后兼容。

## 实现方案

核心思路：**以四元数作为旋转累加的"真实姿态"，每次旋转操作都对当前姿态四元数做 world-frame 复合（premultiply），再把结果吸附回最近的 90° 整数对称姿态（`normDeg` 规整），最后回写为欧拉角供存储/渲染。** 这样复合满足结合律、与操作顺序一致、消除万向锁；单轴旋转结果与旧实现完全一致（"转轴过中心只旋转不位移"的正确行为保留）。

### 关键决策

1. **world-frame 复合**：与立方体 `rotateWorldAxis`（premultiply 世界轴）保持一致，X/Y/Z 按钮即"绕世界坐标轴旋转"，语义统一。
2. **每次吸附整数矩阵**：由四元数取 `Matrix4` 后 `setFromRotationMatrix` 得欧拉，并以 `normDeg` 规整到 90° 倍数，杜绝浮点漂移与欧拉歧义导致的累积误差。
3. **旋转中心补偿逻辑不动**：`rotateLayer` 中基于 `rotateGridPos(center, newRot)` 的 `l.pos` 偏移补偿对四元数得出的 `newRot` 同样成立，保持"旋转中心世界位置不变"。

## 实现位置与改动

- `src/scene/layerMath.ts`
- 新增 `rotateByAxis(r, axis, deltaDeg)`，用 `quatOf(r).premultiply(qDelta)` 复合并返回吸附后的欧拉（复用现有 `quatOf`、`normDeg`）。
- 改写 `invertRotation(r)` 为 `quatOf(r).invert()` 后再取欧拉规整，修正多轴逆变换。
- `src/main.ts`
- 导入 `rotateByAxis`。
- `rotateLayer`（约 458 行）把 `normRotation({...l.rotation,[axis]:l.rotation[axis]+delta})` 改为 `rotateByAxis(l.rotation, axis, delta)`，其余中心补偿/`history`/`syncLayer` 逻辑保持。
- `previewRotate`（约 650 行）同样改为 `rotateByAxis(layer.rotation, axis, delta)`。
- `src/ui/LayerPanel.ts`、`src/model/types.ts`：无需改动（按钮签名与 `Rotation` 类型不变）。

## 验证

- `npx tsc --noEmit` 与 lint 零错误。
- 复现用户场景：先 X+90（A）、再 Y-90（B）；在 A、B 基础上各做 X+90（C），确认两次 C 后几何体相对其各自旋转中心的偏移一致、且整体姿态符合四元数复合预期（与立方体侧一致）。
- 单轴旋转 + 旋转中心过几何中心：确认只有旋转、无意外位移。
- 加载旧存档后做多次多轴旋转，确认姿态稳定、撤销/重做（`history`）正确。