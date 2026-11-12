/**
 * ==========================================================================
 * Module       : navigation.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-11
 * Version      : 2.2.1 (Sprint 3 – graph + Dijkstra)
 * Description  : Loads the building graph from a JSON file, stores it as
 *                an adjacency list, and exposes pathfinding via the
 *                Strategy pattern (ShortestPathStrategy by default).
 *                Also provides helper methods for direction vectors and
 *                distance calculation.
 * ==========================================================================
 */

// ===========================================================================
// Strategy Pattern – Route-finding algorithms
// ===========================================================================

/**
 * RouteStrategy (interface / base class)
 * ----------------------------------------
 * Abstract strategy that every routing algorithm must implement.
 * Subclasses override findPath() with their own logic.
 */
class RouteStrategy {
  /**
   * findPath
   * --------
   * Finds a path from startId to endId in the given adjacency list.
   *
   * @param   {Map}    adjacency – Map<string, Array<{nodeId, weight}>>
   * @param   {string} startId   – Starting node identifier.
   * @param   {string} endId     – Destination node identifier.
   * @returns {string[]} Ordered array of node IDs forming the path,
   *                     or an empty array if no path exists.
   */
  findPath(adjacency, startId, endId) {
    throw new Error('RouteStrategy.findPath() must be overridden');
  }
}

/**
 * ShortestPathStrategy
 * --------------------
 * Classic Dijkstra algorithm on a weighted undirected graph.
 * Guarantees the shortest (lightest) path when all weights ≥ 0.
 */
class ShortestPathStrategy extends RouteStrategy {
  /**
   * findPath – Dijkstra implementation
   *
   * @param   {Map}    adjacency – The graph adjacency list.
   * @param   {string} startId   – Source node.
   * @param   {string} endId     – Target node.
   * @returns {string[]} Shortest path as an array of node IDs.
   */
  findPath(adjacency, startId, endId) {
    // Distance from startId to every other node (Infinity = not visited)
    const distances = new Map();
    // Previous node on the shortest path (for back-tracking)
    const previous = new Map();
    // Set of nodes not yet finalised
    const unvisited = new Set();

    // Initialise distances
    for (const nodeId of adjacency.keys()) {
      distances.set(nodeId, Infinity);
      previous.set(nodeId, null);
      unvisited.add(nodeId);
    }
    distances.set(startId, 0);

    // Main loop — process the closest unvisited node
    while (unvisited.size > 0) {
      // Find the unvisited node with the smallest distance
      let currentNodeId = null;
      let currentMinDistance = Infinity;

      for (const nodeId of unvisited) {
        const dist = distances.get(nodeId);
        if (dist < currentMinDistance) {
          currentMinDistance = dist;
          currentNodeId = nodeId;
        }
      }

      // If no reachable node found, the graph is disconnected
      if (currentNodeId === null || currentMinDistance === Infinity) {
        break;
      }

      // Early exit if we reached the destination
      if (currentNodeId === endId) {
        break;
      }

      // Remove current node from unvisited set
      unvisited.delete(currentNodeId);

      // Relax all neighbours
      const neighbours = adjacency.get(currentNodeId) || [];
      for (const { nodeId: neighbourId, weight } of neighbours) {
        if (!unvisited.has(neighbourId)) continue;

        const candidateDistance = currentMinDistance + weight;
        if (candidateDistance < distances.get(neighbourId)) {
          distances.set(neighbourId, candidateDistance);
          previous.set(neighbourId, currentNodeId);
        }
      }
    }

    // Back-track from endId to startId to reconstruct the path
    const path = [];
    let step = endId;

    while (step !== null) {
      path.unshift(step);
      step = previous.get(step);
    }

    // If the path does not start with startId, there is no valid route
    if (path[0] !== startId) {
      return [];
    }

    return path;
  }
}

/**
 * AvoidStairsStrategy
 * --------------------
 * Placeholder strategy for future use (v2 — multi-floor support).
 * Currently behaves identically to ShortestPathStrategy because
 * the v1 building graph contains a single floor with no stairs.
 * When stair edges are added to the graph, this strategy will
 * filter them out before running Dijkstra.
 */
class AvoidStairsStrategy extends RouteStrategy {
  /**
   * findPath – Dijkstra without stair edges (future v2 feature).
   *
   * @param   {Map}    adjacency – The graph adjacency list.
   * @param   {string} startId   – Source node.
   * @param   {string} endId     – Target node.
   * @returns {string[]} Path avoiding stair edges.
   */
  findPath(adjacency, startId, endId) {
    // In v1 there are no stair edges, so delegate to ShortestPath
    const shortestPath = new ShortestPathStrategy();
    return shortestPath.findPath(adjacency, startId, endId);
  }
}

// ===========================================================================
// BuildingGraph – main public class
// ===========================================================================

/**
 * BuildingGraph
 * -------------
 * Loads and queries the building floor plan.
 *
 * Public API:
 *   loadGraph(url)                   – fetch + parse building.json
 *   getNode(id)                      – returns { name, x, y } or null
 *   getAllDestinations()              – returns [{ id, name }, …]
 *   findShortestPath(fromId, toId)   – returns [nodeId, …]
 *   getPathDistance(path)             – sum of edge weights along a path
 *   getDirectionVector(fromId, toId) – { dx, dy } unit vector
 *   setStrategy(strategy)            – switch routing algorithm
 */
export class BuildingGraph {
  /** @type {Object}  Raw parsed JSON (building metadata) */
  #buildingMeta = null;

  /** @type {Map<string, {name:string, x:number, y:number}>}  Node lookup */
  #nodes = new Map();

  /**
   * @type {Map<string, Array<{nodeId:string, weight:number}>>}
   * Adjacency list (undirected – each edge stored both ways)
   */
  #adjacency = new Map();

  /** @type {Array<{from:string, to:string, weight:number}>} Original edges */
  #edges = [];

  /** @type {RouteStrategy}  Active routing strategy */
  #strategy = new ShortestPathStrategy();

  // -----------------------------------------------------------------------
  // Graph loading
  // -----------------------------------------------------------------------

  /**
   * loadGraph
   * ---------
   * Fetches the building JSON file, parses nodes and edges, and builds
   * the internal adjacency list.
   *
   * @param {string} url – Relative or absolute URL to the JSON file.
   */
  async loadGraph(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load building graph: ${response.status}`);
    }

    const data = await response.json();
    this.loadFromData(data);
  }

  /**
   * loadFromData
   * ------------
   * Builds the graph from an already-parsed object. Kept separate from
   * loadGraph so routing can be tested without HTTP.
   *
   * @param {Object} data – Parsed building.json content.
   */
  loadFromData(data) {
    this.#buildingMeta = data.building;

    // --- Parse nodes ---
    this.#nodes.clear();
    this.#adjacency.clear();
    this.#edges = [];

    for (const [nodeId, nodeData] of Object.entries(data.nodes)) {
      this.#nodes.set(nodeId, {
        name: nodeData.name,
        x: nodeData.x,
        y: nodeData.y
      });
      // Initialise an empty neighbour list for every node
      this.#adjacency.set(nodeId, []);
    }

    // --- Parse edges (undirected → add both directions) ---
    for (const edge of data.edges) {
      const { from, to, weight } = edge;

      if (!this.#adjacency.has(from) || !this.#adjacency.has(to)) {
        console.warn(`[navigation] Skipping invalid edge: ${from} → ${to}`);
        continue;
      }

      this.#edges.push({ from, to, weight });
      this.#adjacency.get(from).push({ nodeId: to, weight });
      this.#adjacency.get(to).push({ nodeId: from, weight });
    }

    console.log(
      `[navigation] Graph loaded: ${this.#nodes.size} nodes, ` +
      `${data.edges.length} edges`
    );
  }

  // -----------------------------------------------------------------------
  // Node queries
  // -----------------------------------------------------------------------

  /**
   * getNode
   * -------
   * Returns the metadata for a single node.
   *
   * @param   {string} nodeId – The node identifier (matches QR code data).
   * @returns {{ name:string, x:number, y:number } | null}
   */
  getNode(nodeId) {
    return this.#nodes.get(nodeId) || null;
  }

  /**
   * getAllDestinations
   * -----------------
   * Returns a sorted list of all nodes that can serve as destinations.
   * (Every node in the graph is a potential destination.)
   *
   * @returns {Array<{ id:string, name:string }>}
   */
  getAllDestinations() {
    const destinations = [];
    for (const [id, node] of this.#nodes) {
      destinations.push({ id, name: node.name });
    }
    // Sort alphabetically by display name
    destinations.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return destinations;
  }

  /**
   * getAllNodes
   * -----------
   * Returns every graph node with its coordinates, for the floor-plan view.
   *
   * @returns {Array<{ id:string, name:string, x:number, y:number }>}
   */
  getAllNodes() {
    return Array.from(this.#nodes, ([id, node]) => ({ id, ...node }));
  }

  /**
   * getEdges
   * --------
   * Returns a copy of the original weighted edges.
   *
   * @returns {Array<{ from:string, to:string, weight:number }>}
   */
  getEdges() {
    return this.#edges.map((edge) => ({ ...edge }));
  }

  /**
   * getBuildingInfo
   * --------------
   * Returns building metadata (name, floor, description).
   *
   * @returns {Object|null}
   */
  getBuildingInfo() {
    return this.#buildingMeta;
  }

  // -----------------------------------------------------------------------
  // Strategy selection
  // -----------------------------------------------------------------------

  /**
   * setStrategy
   * -----------
   * Changes the routing algorithm (Strategy pattern).
   *
   * @param {RouteStrategy} strategy – A RouteStrategy subclass instance.
   */
  setStrategy(strategy) {
    if (!(strategy instanceof RouteStrategy)) {
      throw new TypeError('strategy must be a RouteStrategy instance');
    }
    this.#strategy = strategy;
  }

  // -----------------------------------------------------------------------
  // Pathfinding
  // -----------------------------------------------------------------------

  /**
   * findShortestPath
   * ----------------
   * Delegates to the active strategy to compute a path.
   *
   * @param   {string}   fromId – Starting node ID.
   * @param   {string}   toId   – Destination node ID.
   * @returns {string[]} Ordered node IDs forming the path, or [].
   */
  findShortestPath(fromId, toId) {
    if (!this.#nodes.has(fromId)) {
      console.error(`[navigation] Unknown start node: ${fromId}`);
      return [];
    }
    if (!this.#nodes.has(toId)) {
      console.error(`[navigation] Unknown end node: ${toId}`);
      return [];
    }

    return this.#strategy.findPath(this.#adjacency, fromId, toId);
  }

  // -----------------------------------------------------------------------
  // Distance and direction helpers
  // -----------------------------------------------------------------------

  /**
   * getPathDistance
   * --------------
   * Sums the edge weights along a given path.
   *
   * @param   {string[]} path – Array of node IDs in order.
   * @returns {number}   Total distance (sum of weights), or 0 if invalid.
   */
  getPathDistance(path) {
    if (!path || path.length < 2) return 0;

    let totalDistance = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const currentId = path[i];
      const nextId = path[i + 1];
      const neighbours = this.#adjacency.get(currentId) || [];
      const edge = neighbours.find((n) => n.nodeId === nextId);

      if (edge) {
        totalDistance += edge.weight;
      } else {
        console.warn(`[navigation] No edge between ${currentId} and ${nextId}`);
      }
    }

    return totalDistance;
  }

  /**
   * getDirectionVector
   * ------------------
   * Returns a normalised 2D direction vector pointing from one node
   * toward another. Used to orient the AR arrow.
   *
   * @param   {string} fromId – Source node ID.
   * @param   {string} toId   – Target node ID.
   * @returns {{ dx:number, dy:number }} Unit vector, or {0,0} if invalid.
   */
  getDirectionVector(fromId, toId) {
    const fromNode = this.#nodes.get(fromId);
    const toNode = this.#nodes.get(toId);

    if (!fromNode || !toNode) {
      return { dx: 0, dy: 0 };
    }

    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) {
      return { dx: 0, dy: 0 };
    }

    return {
      dx: dx / length,
      dy: dy / length
    };
  }

  /**
   * getEuclideanDistance
   * -------------------
   * Straight-line distance between two nodes (used for display, not routing).
   *
   * @param   {string} fromId – Node A.
   * @param   {string} toId   – Node B.
   * @returns {number} Euclidean distance in building coordinate units.
   */
  getEuclideanDistance(fromId, toId) {
    const fromNode = this.#nodes.get(fromId);
    const toNode = this.#nodes.get(toId);

    if (!fromNode || !toNode) return 0;

    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

// ===========================================================================
// Named exports for the Strategy classes (so main.js can switch strategies)
// ===========================================================================
export { ShortestPathStrategy, AvoidStairsStrategy };

