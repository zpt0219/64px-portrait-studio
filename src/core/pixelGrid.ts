/**
 * 64×64 像素网格常量与通用邻域 / 连通域工具
 */

export const IMAGE_WIDTH = 64;
export const IMAGE_HEIGHT = 64;
export const PIXEL_COUNT = IMAGE_WIDTH * IMAGE_HEIGHT;

const FOUR_NEIGHBOUR_DELTAS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const EIGHT_NEIGHBOUR_DELTAS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export function* getNeighbours(offset: number, diagonal: boolean): Generator<number> {
  const x = offset % IMAGE_WIDTH;
  const y = Math.floor(offset / IMAGE_WIDTH);
  const deltas = diagonal ? EIGHT_NEIGHBOUR_DELTAS : FOUR_NEIGHBOUR_DELTAS;
  for (const [dx, dy] of deltas) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < IMAGE_WIDTH && ny >= 0 && ny < IMAGE_HEIGHT) {
      yield ny * IMAGE_WIDTH + nx;
    }
  }
}

/** 四条边上的全部像素 (去重，顺序：上、下、左、右) */
export function borderOffsets(): number[] {
  const result = new Set<number>();
  for (let x = 0; x < IMAGE_WIDTH; x++) result.add(x);
  for (let x = 0; x < IMAGE_WIDTH; x++) result.add((IMAGE_HEIGHT - 1) * IMAGE_WIDTH + x);
  for (let y = 0; y < IMAGE_HEIGHT; y++) result.add(y * IMAGE_WIDTH);
  for (let y = 0; y < IMAGE_HEIGHT; y++) result.add(y * IMAGE_WIDTH + IMAGE_WIDTH - 1);
  return Array.from(result);
}

/** 上、左、右三条边的像素 (不含底边) */
export function sideAndTopOffsets(): number[] {
  const result = new Set<number>();
  for (let x = 0; x < IMAGE_WIDTH; x++) result.add(x);
  for (let y = 0; y < IMAGE_HEIGHT; y++) result.add(y * IMAGE_WIDTH);
  for (let y = 0; y < IMAGE_HEIGHT; y++) result.add(y * IMAGE_WIDTH + IMAGE_WIDTH - 1);
  return Array.from(result);
}

export function connectedComponents(mask: ArrayLike<boolean | number>, diagonal = false): number[][] {
  const seen = new Uint8Array(PIXEL_COUNT);
  const output: number[][] = [];

  for (let start = 0; start < PIXEL_COUNT; start++) {
    if (!mask[start] || seen[start]) continue;

    const stack: number[] = [start];
    seen[start] = 1;
    const component: number[] = [];

    while (stack.length > 0) {
      const offset = stack.pop()!;
      component.push(offset);
      for (const neighbour of getNeighbours(offset, diagonal)) {
        if (mask[neighbour] && !seen[neighbour]) {
          seen[neighbour] = 1;
          stack.push(neighbour);
        }
      }
    }
    output.push(component);
  }
  return output;
}

/**
 * 从种子像素出发，按 4 或 8 邻域泛洪，返回所有可达且满足 canEnter 的像素 (BFS 顺序)。
 * 种子本身也需满足 canEnter。
 */
export function floodFill(
  seeds: Iterable<number>,
  canEnter: (offset: number) => boolean,
  diagonal = false
): number[] {
  const visited = new Uint8Array(PIXEL_COUNT);
  const queue: number[] = [];

  for (const offset of seeds) {
    if (!visited[offset] && canEnter(offset)) {
      visited[offset] = 1;
      queue.push(offset);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    for (const neighbour of getNeighbours(queue[head], diagonal)) {
      if (!visited[neighbour] && canEnter(neighbour)) {
        visited[neighbour] = 1;
        queue.push(neighbour);
      }
    }
  }
  return queue;
}

/** floodFill 的布尔掩码版本 */
export function floodMask(candidates: ArrayLike<boolean | number>, seeds: Iterable<number>): boolean[] {
  const flooded = new Array<boolean>(PIXEL_COUNT).fill(false);
  for (const offset of floodFill(seeds, (o) => Boolean(candidates[o]))) {
    flooded[offset] = true;
  }
  return flooded;
}

/** 由像素集合生成布尔掩码 */
export function maskFromOffsets(offsets: Iterable<number>): boolean[] {
  const mask = new Array<boolean>(PIXEL_COUNT).fill(false);
  for (const offset of offsets) mask[offset] = true;
  return mask;
}
