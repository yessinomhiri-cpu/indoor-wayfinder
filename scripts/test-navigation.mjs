import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BuildingGraph,
  AvoidStairsStrategy
} from '../src/navigation.js';

const buildingData = JSON.parse(
  readFileSync(new URL('../assets/building.json', import.meta.url), 'utf8')
);

function createGraph() {
  const graph = new BuildingGraph();
  graph.loadFromData(buildingData);
  return graph;
}

test('building graph exposes every declared node', () => {
  const graph = createGraph();
  assert.equal(
    graph.getAllDestinations().length,
    Object.keys(buildingData.nodes).length
  );
  assert.equal(graph.getBuildingInfo().floor, 'Rez-de-chaussée');
});

test('building graph exposes nodes and edges for the floor plan', () => {
  const graph = createGraph();
  assert.equal(graph.getAllNodes().length, Object.keys(buildingData.nodes).length);
  assert.equal(graph.getEdges().length, buildingData.edges.length);
});

test('every edge endpoint exists and has a positive weight', () => {
  const nodeIds = new Set(Object.keys(buildingData.nodes));

  for (const edge of buildingData.edges) {
    assert.ok(nodeIds.has(edge.from), `unknown edge source: ${edge.from}`);
    assert.ok(nodeIds.has(edge.to), `unknown edge target: ${edge.to}`);
    assert.ok(edge.weight > 0, `invalid weight: ${edge.from} -> ${edge.to}`);
  }
});

test('shortest path from the entrance to Salle B12', () => {
  const graph = createGraph();
  const path = graph.findShortestPath('ENTREE', 'SALLE_B12');

  assert.deepEqual(path, ['ENTREE', 'HALL', 'COULOIR_EST', 'SALLE_B12']);
  assert.equal(graph.getPathDistance(path), 26);
});

test('shortest path from the entrance to Amphi A', () => {
  const graph = createGraph();
  const path = graph.findShortestPath('ENTREE', 'AMPHI_A');

  assert.deepEqual(path, [
    'ENTREE',
    'HALL',
    'COULOIR_SUD',
    'COULOIR_OUEST',
    'ADMIN',
    'AMPHI_A'
  ]);
  assert.equal(graph.getPathDistance(path), 54);
});

test('the AvoidStairs strategy matches the single-floor route', () => {
  const graph = createGraph();
  graph.setStrategy(new AvoidStairsStrategy());

  assert.deepEqual(
    graph.findShortestPath('ENTREE', 'SALLE_B12'),
    ['ENTREE', 'HALL', 'COULOIR_EST', 'SALLE_B12']
  );
});

test('unknown nodes and same-node routes are handled', () => {
  const graph = createGraph();

  assert.deepEqual(graph.findShortestPath('ENTREE', 'UNKNOWN'), []);
  assert.deepEqual(graph.findShortestPath('SALLE_B12', 'SALLE_B12'), ['SALLE_B12']);
});

test('every node is reachable from the entrance', () => {
  const graph = createGraph();

  for (const nodeId of Object.keys(buildingData.nodes)) {
    const path = graph.findShortestPath('ENTREE', nodeId);
    assert.ok(path.length > 0, `${nodeId} should be reachable`);
    assert.equal(path[0], 'ENTREE');
  }
});

test('direction vectors are normalised', () => {
  const graph = createGraph();
  const direction = graph.getDirectionVector('ENTREE', 'HALL');

  assert.equal(direction.dx, 1);
  assert.equal(direction.dy, 0);
  assert.ok(Math.abs(Math.hypot(direction.dx, direction.dy) - 1) < 1e-9);
});

test('euclidean distance is computed from node coordinates', () => {
  const graph = createGraph();
  assert.equal(graph.getEuclideanDistance('ENTREE', 'HALL'), 10);
});
