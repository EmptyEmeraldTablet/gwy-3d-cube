import { FaceId } from './types';
import templates from './netTemplates.json';

/** 展开图中一个面所在的格子与朝向（rot 为相对根面的 2D 旋转角，单位度）。 */
export interface NetCell {
  face: FaceId;
  col: number;
  row: number;
  rot: number; // 数学坐标系（y 向上）下的 2D 旋转角，90 的整数倍
}

/** 正方体展开图模板。 */
export interface NetTemplate {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: NetCell[];
}

/* Stable template IDs and face assignments; generator retained for independent checks. */
export const NET_TEMPLATES: NetTemplate[] = templates as NetTemplate[];
