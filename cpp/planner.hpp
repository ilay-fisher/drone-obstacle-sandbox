/// @file planner.hpp
/// Grid path planner for the drone sandbox: A* (full search) and D* Lite (incremental).
/// Interface contract: docs/CONTRACTS.md sections 1 and 2.
#pragma once

#include <cstdint>
#include <vector>

/// Indexed binary min-heap over node ids [0, capacity) with a two-part (lexicographic) key.
///
/// Why indexed: both A* and D* Lite need decrease-key / remove-by-id. A position map
/// (`pos_`) gives O(log n) update and remove without lazy duplicates, so the heap never
/// holds more than one entry per node and its storage is bounded by the node count.
/// All storage is allocated once in init(); no method allocates afterwards.
class IndexedMinHeap {
public:
  /// Allocates storage for `capacity` node ids. Only call from a constructor.
  void init(int capacity);
  /// Empties the heap in O(size) by resetting only the occupied position slots.
  void clear();
  bool empty() const;
  bool contains(int node) const;
  /// Node with the smallest key. Undefined when empty.
  int top() const;
  /// Removes and returns the node with the smallest key.
  int pop();
  /// Inserts `node` or changes its key (works for decrease and increase).
  void pushOrUpdate(int node, double k1, double k2);
  /// Removes `node` if present.
  void remove(int node);
  double key1(int node) const;
  double key2(int node) const;

private:
  bool less(int a, int b) const;
  void swapAt(int i, int j);
  void siftUp(int i);
  void siftDown(int i);
  void removeAt(int i);

  std::vector<int32_t> heap_;   ///< heap-ordered node ids
  std::vector<int32_t> pos_;    ///< node id -> index in heap_, or -1 when absent
  std::vector<double> k1_, k2_; ///< per-node key parts
  int size_ = 0;
};

/// Grid planner. See docs/CONTRACTS.md section 2 for the semantics of every method.
class DronePlanner {
public:
  DronePlanner(int width, int height);

  void setCell(int x, int y, int value);
  int getCell(int x, int y) const;
  void clearGrid();

  bool computePath(int sx, int sy, int gx, int gy, int mode);
  bool hasPathObstruction(int droneX, int droneY, int sensorRadius, int fromIndex) const;

  int getLastExpandedCount() const;
  double getLastReplanMs() const;
  double getPathCost() const;
  int getPathLength() const;
  int getReplanCount() const;

  int width() const;
  int height() const;

  /// Raw buffers (size width*height). Additive to the contract; used by the bindings and tests.
  const uint8_t* gridData() const;
  const uint8_t* heatData() const;
  const int32_t* pathData() const;

private:
  // Shared helpers.
  int stepTarget(int x, int y, int d) const;
  double moveCost(int d, int to) const;
  double octile(int a, int b) const;
  bool lineOfSight(int x0, int y0, int x1, int y1) const;
  void bumpHeat(int idx);
  void resetResult();

  // A*.
  bool runAStar(int start, int goal);
  void buildPathFromParents(int goal);

  // D* Lite.
  void dsInit(int start, int goal);
  void dsCalcKey(int u, double& k1, double& k2) const;
  void dsUpdateVertex(int u);
  void dsUpdateNeighbors(int u);
  void dsCompute();
  bool runDStar(int start, int goal);

  int w_, h_, n_;
  std::vector<uint8_t> grid_, heat_;
  std::vector<int32_t> path_;
  int pathLen_ = 0;
  double pathCost_ = -1.0;
  int lastExpanded_ = 0;
  double lastMs_ = 0.0;
  int replanCount_ = 0;

  // A* state.
  IndexedMinHeap aHeap_;
  std::vector<double> aG_;
  std::vector<int32_t> aParent_;
  std::vector<uint8_t> aClosed_;

  // D* Lite state, persistent between calls.
  IndexedMinHeap dHeap_;
  std::vector<double> dG_, dRhs_;
  bool dsValid_ = false;
  int dsGoal_ = -1, dsStart_ = -1, dsLast_ = -1;
  double dsKm_ = 0.0;
  std::vector<int32_t> pending_;     ///< cells changed via setCell since D* last ran
  std::vector<uint8_t> pendingFlag_; ///< dedupe flag per cell
  int pendingCount_ = 0;
};
