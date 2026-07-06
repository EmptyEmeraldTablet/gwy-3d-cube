import { Cube, FaceId, FACE_ORDER, GridPos, Layer, Rotation } from './types';

export interface SerializedCube {
  id: string;
  gridPos: GridPos;
  size: number;
  rotation: Rotation;
  layerId: string;
  color?: string;
  faces: Record<FaceId, string>; // 每面 canvas 的 dataURL
}

export interface SerializedLayer {
  id: string;
  name: string;
  pos: GridPos;
  rotation: Rotation;
  visible: boolean;
  opacity: number;
}

export interface SerializedScene {
  version: number;
  gridSize: number;
  layers: SerializedLayer[];
  activeLayerId: string;
  cubes: SerializedCube[];
}

/** 把当前场景（含图层与立方体颜色）序列化为 JSON 友好的结构。 */
export function serializeScene(
  cubes: Cube[],
  layers: Layer[],
  activeLayerId: string,
  gridSize: number
): SerializedScene {
  return {
    version: 1,
    gridSize,
    layers: layers.map((l) => ({
      id: l.id,
      name: l.name,
      pos: { ...l.pos },
      rotation: { ...l.rotation },
      visible: l.visible,
      opacity: l.opacity,
    })),
    activeLayerId,
    cubes: cubes.map((c) => ({
      id: c.id,
      gridPos: { ...c.gridPos },
      size: c.size,
      rotation: { ...c.rotation },
      layerId: c.layerId,
      color: c.color,
      faces: Object.fromEntries(
        FACE_ORDER.map((f) => [f, c.faces[f].canvas.toDataURL('image/png')])
      ) as Record<FaceId, string>,
    })),
  };
}

/** 触发浏览器下载场景为 .json 文件。 */
export function downloadScene(
  cubes: Cube[],
  layers: Layer[],
  activeLayerId: string,
  gridSize: number,
  filename = 'scene.json'
): void {
  const data = JSON.stringify(serializeScene(cubes, layers, activeLayerId, gridSize));
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 读取 .json 文件并解析为场景结构。 */
export function readSceneFile(file: File): Promise<SerializedScene> {
  return file.text().then((t) => JSON.parse(t) as SerializedScene);
}
