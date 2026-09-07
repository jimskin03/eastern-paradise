/**
 * A* Pathfinding Engine for Eastern Paradise Sanctuary (40x30 grid).
 */

class PriorityQueue {
  constructor() {
    this.elements = [];
  }

  enqueue(item, priority) {
    this.elements.push({ item, priority });
    this.elements.sort((a, b) => a.priority - b.priority);
  }

  dequeue() {
    return this.elements.shift()?.item;
  }

  isEmpty() {
    return this.elements.length === 0;
  }
}

function heuristic(a, b) {
  // Manhattan distance
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function posKey(pos) {
  return `${pos[0]},${pos[1]}`;
}

export class NavigationSystem {
  /**
   * Finds the shortest walkable path between start and target.
   * @param {number[]} start [x, y]
   * @param {number[]} target [x, y]
   * @param {(x: number, y: number) => boolean} isWalkable
   * @param {object} [options]
   * @param {boolean} [options.allowAdjacent=true] If target is unwalkable, target nearest walkable neighbor
   * @param {number} [options.maxNodes=2500]
   * @returns {number[][]} Array of [x, y] points from step 1 to destination, or empty array if unreachable.
   */
  static findPath(start, target, isWalkable, options = {}) {
    const [sx, sy] = start;
    let [tx, ty] = target;

    if (sx === tx && sy === ty) {
      return [];
    }

    // If target itself is not walkable, attempt to route to closest walkable adjacent tile
    if (!isWalkable(tx, ty)) {
      if (options.allowAdjacent !== false) {
        const neighbors = [
          [tx, ty - 1], [tx, ty + 1], [tx - 1, ty], [tx + 1, ty],
          [tx - 1, ty - 1], [tx + 1, ty - 1], [tx - 1, ty + 1], [tx + 1, ty + 1]
        ].filter(([nx, ny]) => isWalkable(nx, ny));

        if (neighbors.length === 0) return [];
        // Pick neighbor closest to start
        neighbors.sort((a, b) => heuristic(start, a) - heuristic(start, b));
        [tx, ty] = neighbors[0];
        if (sx === tx && sy === ty) return [];
      } else {
        return [];
      }
    }

    const frontier = new PriorityQueue();
    frontier.enqueue([sx, sy], 0);

    const cameFrom = new Map();
    const costSoFar = new Map();

    const sKey = posKey([sx, sy]);
    cameFrom.set(sKey, null);
    costSoFar.set(sKey, 0);

    const targetKey = posKey([tx, ty]);
    let reached = false;
    let iterations = 0;
    const maxNodes = options.maxNodes || 2500;

    const directions = [
      [0, -1], // north
      [0, 1],  // south
      [1, 0],  // east
      [-1, 0]  // west
    ];

    while (!frontier.isEmpty() && iterations++ < maxNodes) {
      const current = frontier.dequeue();
      const currentKey = posKey(current);

      if (currentKey === targetKey) {
        reached = true;
        break;
      }

      for (const [dx, dy] of directions) {
        const next = [current[0] + dx, current[1] + dy];
        const nextKey = posKey(next);

        if (!isWalkable(next[0], next[1])) {
          continue;
        }

        const newCost = costSoFar.get(currentKey) + 1;
        if (!costSoFar.has(nextKey) || newCost < costSoFar.get(nextKey)) {
          costSoFar.set(nextKey, newCost);
          const priority = newCost + heuristic(next, [tx, ty]);
          frontier.enqueue(next, priority);
          cameFrom.set(nextKey, current);
        }
      }
    }

    if (!reached) {
      return [];
    }

    // Reconstruct path
    const path = [];
    let curr = [tx, ty];
    while (curr) {
      const parent = cameFrom.get(posKey(curr));
      if (parent) {
        path.unshift(curr);
      }
      curr = parent;
    }

    return path;
  }
}
