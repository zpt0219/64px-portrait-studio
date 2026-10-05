import { SemanticZone, ZONE_CONFIG, ALL_ZONES } from './constants';
import { Rgb, hexToRgb } from '../utils/colorUtils';

/** 各分区的 RGB 配色；背景色因用途不同 (画布覆盖层 / 导出遮罩) 由调用方指定 */
export function zoneRgbTable(backgroundRgb: Rgb): Record<SemanticZone, Rgb> {
  const table = {} as Record<SemanticZone, Rgb>;
  for (const zone of ALL_ZONES) {
    table[zone] = zone === SemanticZone.Background ? backgroundRgb : hexToRgb(ZONE_CONFIG[zone].color);
  }
  return table;
}

