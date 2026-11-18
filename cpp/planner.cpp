/// @file planner.cpp
/// A* and D* Lite on a flat 8-connected grid.
///
/// Memory policy: every buffer (grid, heat, path, both heaps, A* and D* node arrays, the
/// pending-change list) is sized in the constructor from width*height. computePath() and
/// hasPathObstruction() only read and write those buffers, so they never touch the heap
/// allocator. That keeps per-tick latency flat and lets JS hold zero-copy views that never
/// dangle.
#include "planner.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <limits>

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kDiag = 1.4142135623730951;  // sqrt(2)
constexpr double kWindMultiplier = 4.0;
constexpr uint8_t kWall = 1;
constexpr uint8_t kWind = 2;
constexpr double kKeyEps = 1e-9;

/// Lexicographic key comparison with a tolerance on the first component. Path costs are
/// sums of sqrt(2) terms while the heuristic is a closed form, so two mathematically equal
/// keys can differ by a few ulps. An exact compare would then end the D* Lite loop while a
/// vertex on the active route is still stale. Near-ties fall through to the second key.
inline bool keyLess(double a1, double a2, double b1, double b2) {
  if (a1 < b1 - kKeyEps) return true;
  if (a1 > b1 + kKeyEps) return false;
  return a2 < b2 - kKeyEps;
}

struct Dir { int dx, dy; double cost; };
/// Eight neighbours: four straight (cost 1) then four diagonal (cost sqrt 2).
constexpr Dir kDirs[8] = {{1, 0, 1.0},  {-1, 0, 1.0},      {0, 1, 1.0},       {0, -1, 1.0},
                          {1, 1, kDiag}, {1, -1, kDiag}, {-1, 1, kDiag}, {-1, -1, kDiag}};

}  // namespace

// ------------------------------------------------------------------ IndexedMinHeap

void IndexedMinHeap::init(int capacity) {
  heap_.assign(capacity, 0);
  pos_.assign(capacity, -1);
  k1_.assign(capacity, 0.0);
  k2_.assign(capacity, 0.0);
  size_ = 0;
}

void IndexedMinHeap::clear() {
  for (int i = 0; i < size_; ++i) pos_[heap_[i]] = -1;
  size_ = 0;
}

bool IndexedMinHeap::empty() const { return size_ == 0; }
bool IndexedMinHeap::contains(int node) const { return pos_[node] >= 0; }
int IndexedMinHeap::top() const { return heap_[0]; }
double IndexedMinHeap::key1(int node) const { return k1_[node]; }
double IndexedMinHeap::key2(int node) const { return k2_[node]; }

bool IndexedMinHeap::less(int a, int b) const {
  return k1_[a] < k1_[b] || (k1_[a] == k1_[b] && k2_[a] < k2_[b]);
}

void IndexedMinHeap::swapAt(int i, int j) {
  std::swap(heap_[i], heap_[j]);
  pos_[heap_[i]] = i;
  pos_[heap_[j]] = j;
}

void IndexedMinHeap::siftUp(int i) {
  while (i > 0) {
    int parent = (i - 1) / 2;
    if (!less(heap_[i], heap_[parent])) break;
    swapAt(i, parent);
    i = parent;
  }
}

void IndexedMinHeap::siftDown(int i) {
  for (;;) {
    int l = 2 * i + 1, r = l + 1, best = i;
    if (l < size_ && less(heap_[l], heap_[best])) best = l;
    if (r < size_ && less(heap_[r], heap_[best])) best = r;
    if (best == i) break;
    swapAt(i, best);
    i = best;
  }
}

void IndexedMinHeap::pushOrUpdate(int node, double k1, double k2) {
  k1_[node] = k1;
  k2_[node] = k2;
  if (pos_[node] < 0) {
    heap_[size_] = node;
    pos_[node] = size_;
    siftUp(size_++);
  } else {
    int i = pos_[node];
    siftUp(i);
    siftDown(pos_[node]);  // the node may have moved up; sift from where it is now
  }
}

void IndexedMinHeap::removeAt(int i) {
  int removed = heap_[i];
  int last = heap_[--size_];
  pos_[removed] = -1;
  if (i != size_) {
    heap_[i] = last;
    pos_[last] = i;
    siftUp(i);
    siftDown(pos_[last]);
  }
}

int IndexedMinHeap::pop() {
  int node = heap_[0];
  removeAt(0);
  return node;
}

void IndexedMinHeap::remove(int node) {
  if (pos_[node] >= 0) removeAt(pos_[node]);
}

// ------------------------------------------------------------------ construction and grid

DronePlanner::DronePlanner(int width, int height)
    : w_(width), h_(height), n_(width * height),
      grid_(n_, 0), heat_(n_, 0), path_(n_, 0),
      aG_(n_, kInf), aParent_(n_, -1), aClosed_(n_, 0),
      dG_(n_, kInf), dRhs_(n_, kInf),
      pending_(n_, 0), pendingFlag_(n_, 0) {
  aHeap_.init(n_);
  dHeap_.init(n_);
}

void DronePlanner::setCell(int x, int y, int value) {
  if (x < 0 || y < 0 || x >= w_ || y >= h_ || value < 0 || value > 2) return;
  int idx = y * w_ + x;
  if (grid_[idx] == value) return;
  grid_[idx] = static_cast<uint8_t>(value);
  // Remember the change so D* Lite can repair only what moved. Each cell is listed once.
  if (!pendingFlag_[idx]) {
    pendingFlag_[idx] = 1;
    pending_[pendingCount_++] = idx;
  }
}

int DronePlanner::getCell(int x, int y) const {
  if (x < 0 || y < 0 || x >= w_ || y >= h_) return kWall;  // outside the map behaves like a wall
  return grid_[y * w_ + x];
}

void DronePlanner::clearGrid() {
  std::fill(grid_.begin(), grid_.end(), 0);
  std::fill(heat_.begin(), heat_.end(), 0);
  std::fill(pendingFlag_.begin(), pendingFlag_.end(), 0);
  pendingCount_ = 0;
  aHeap_.clear();
  dHeap_.clear();
  dsValid_ = false;
  replanCount_ = 0;
  lastExpanded_ = 0;
  lastMs_ = 0.0;
  resetResult();
}

void DronePlanner::resetResult() {
  pathLen_ = 0;
  pathCost_ = -1.0;
}

int DronePlanner::width() const { return w_; }
int DronePlanner::height() const { return h_; }
int DronePlanner::getLastExpandedCount() const { return lastExpanded_; }
double DronePlanner::getLastReplanMs() const { return lastMs_; }
double DronePlanner::getPathCost() const { return pathCost_; }
int DronePlanner::getPathLength() const { return pathLen_; }
int DronePlanner::getReplanCount() const { return replanCount_; }
const uint8_t* DronePlanner::gridData() const { return grid_.data(); }
const uint8_t* DronePlanner::heatData() const { return heat_.data(); }
const int32_t* DronePlanner::pathData() const { return path_.data(); }

// ------------------------------------------------------------------ shared helpers

/// Neighbour of (x,y) in direction d, or -1 if the move is illegal: off the map, into a
/// wall, or a diagonal that would cut the corner of a wall. The rule is symmetric, so the
/// same test serves both successors and predecessors.
int DronePlanner::stepTarget(int x, int y, int d) const {
  const Dir& k = kDirs[d];
  int nx = x + k.dx, ny = y + k.dy;
  if (nx < 0 || ny < 0 || nx >= w_ || ny >= h_) return -1;
  if (grid_[ny * w_ + nx] == kWall) return -1;
  if (k.dx != 0 && k.dy != 0 && (grid_[y * w_ + nx] == kWall || grid_[ny * w_ + x] == kWall)) return -1;
  return ny * w_ + nx;
}

/// Cost of entering `to` along direction d: step length, times 4 on a wind cell.
double DronePlanner::moveCost(int d, int to) const {
  return kDirs[d].cost * (grid_[to] == kWind ? kWindMultiplier : 1.0);
}

/// Octile distance: exact on an open grid at the minimum step cost 1.0, so it never
/// overestimates (wind only makes real costs larger) and is consistent.
double DronePlanner::octile(int a, int b) const {
  int dx = std::abs(a % w_ - b % w_), dy = std::abs(a / w_ - b / w_);
  return dx + dy + (kDiag - 2.0) * std::min(dx, dy);
}

/// Counts one expansion of `idx` in the heat map, saturating at 255 so it fits a uint8.
void DronePlanner::bumpHeat(int idx) {
  if (heat_[idx] < 255) ++heat_[idx];
}

// ------------------------------------------------------------------ computePath

bool DronePlanner::computePath(int sx, int sy, int gx, int gy, int mode) {
  auto t0 = std::chrono::steady_clock::now();
  ++replanCount_;
  lastExpanded_ = 0;
  std::fill(heat_.begin(), heat_.end(), 0);
  resetResult();

  bool found = false;
  bool inRange = sx >= 0 && sy >= 0 && sx < w_ && sy < h_ && gx >= 0 && gy >= 0 && gx < w_ && gy < h_;
  if (inRange && grid_[sy * w_ + sx] != kWall && grid_[gy * w_ + gx] != kWall) {
    int s = sy * w_ + sx, g = gy * w_ + gx;
    found = (mode == 1) ? runDStar(s, g) : runAStar(s, g);
  }
  if (!found) resetResult();

  lastMs_ = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  return found;
}

/// Walks the parent chain goal -> start, writing the path back-to-front into path_.
void DronePlanner::buildPathFromParents(int goal) {
  int len = 0;
  for (int v = goal; v >= 0; v = aParent_[v]) ++len;
  pathLen_ = len;
  for (int v = goal, i = len - 1; v >= 0; v = aParent_[v], --i) path_[i] = v;
  pathCost_ = aG_[goal];
}

/// A*: binary heap ordered by f = g + h, ties broken toward the smaller h (deeper nodes
/// first), which keeps expansions low on open maps. The heuristic is consistent, so a
/// popped node is final and never reopened; a closed flag replaces lazy deletion.
bool DronePlanner::runAStar(int start, int goal) {
  std::fill(aG_.begin(), aG_.end(), kInf);
  std::fill(aParent_.begin(), aParent_.end(), -1);
  std::fill(aClosed_.begin(), aClosed_.end(), 0);
  aHeap_.clear();

  aG_[start] = 0.0;
  aHeap_.pushOrUpdate(start, octile(start, goal), octile(start, goal));
  while (!aHeap_.empty()) {
    int u = aHeap_.pop();
    aClosed_[u] = 1;
    ++lastExpanded_;
    bumpHeat(u);
    if (u == goal) break;
    int ux = u % w_, uy = u / w_;
    for (int d = 0; d < 8; ++d) {
      int v = stepTarget(ux, uy, d);
      if (v < 0 || aClosed_[v]) continue;
      double ng = aG_[u] + moveCost(d, v);
      if (ng < aG_[v]) {
        aG_[v] = ng;
        aParent_[v] = u;
        double h = octile(v, goal);
        aHeap_.pushOrUpdate(v, ng + h, h);  // decrease-key if v is already queued
      }
    }
  }
  if (aG_[goal] == kInf) return false;
  buildPathFromParents(goal);
  return true;
}

// ------------------------------------------------------------------ D* Lite
//
// Koenig and Likhachev, "D* Lite" (2002), optimized version with the km key modifier.
// The search runs backwards from the goal, so g/rhs values describe distance TO the goal
// and stay valid when the drone moves. Per vertex u:
//   g(u)   = current estimate of the cost from u to the goal
//   rhs(u) = one-step lookahead: min over successors s' of cost(u,s') + g(s')
// u is "inconsistent" when g != rhs and lives in the priority queue with key
//   [min(g,rhs) + h(start,u) + km , min(g,rhs)].
// km accumulates h(oldStart,newStart) each time the drone moves, so keys already in the
// queue stay comparable without being recomputed. Changed cells only trigger
// dsUpdateVertex on the cell and its 8 neighbours (every edge touching the cell, including
// diagonals whose corner rule reads it), so repair work is proportional to the affected area.

void DronePlanner::dsCalcKey(int u, double& k1, double& k2) const {
  double m = std::min(dG_[u], dRhs_[u]);
  k1 = m + octile(dsStart_, u) + dsKm_;
  k2 = m;
}

/// Recomputes rhs(u) from its successors and fixes u's queue membership.
void DronePlanner::dsUpdateVertex(int u) {
  if (u != dsGoal_) {
    double best = kInf;
    if (grid_[u] != kWall) {
      int ux = u % w_, uy = u / w_;
      for (int d = 0; d < 8; ++d) {
        int v = stepTarget(ux, uy, d);
        if (v >= 0) best = std::min(best, moveCost(d, v) + dG_[v]);
      }
    }
    dRhs_[u] = best;
  }
  if (dG_[u] != dRhs_[u]) {
    double k1, k2;
    dsCalcKey(u, k1, k2);
    dHeap_.pushOrUpdate(u, k1, k2);
  } else {
    dHeap_.remove(u);
  }
}

/// Updates every in-bounds neighbour: those are exactly the vertices whose rhs reads u.
void DronePlanner::dsUpdateNeighbors(int u) {
  int ux = u % w_, uy = u / w_;
  for (int d = 0; d < 8; ++d) {
    int nx = ux + kDirs[d].dx, ny = uy + kDirs[d].dy;
    if (nx >= 0 && ny >= 0 && nx < w_ && ny < h_) dsUpdateVertex(ny * w_ + nx);
  }
}

/// Fresh search state for a new goal: only the goal is inconsistent (rhs = 0).
void DronePlanner::dsInit(int start, int goal) {
  std::fill(dG_.begin(), dG_.end(), kInf);
  std::fill(dRhs_.begin(), dRhs_.end(), kInf);
  dHeap_.clear();
  std::fill(pendingFlag_.begin(), pendingFlag_.end(), 0);  // fresh state already sees the grid
  pendingCount_ = 0;
  dsGoal_ = goal;
  dsStart_ = dsLast_ = start;
  dsKm_ = 0.0;
  dRhs_[goal] = 0.0;
  double k1, k2;
  dsCalcKey(goal, k1, k2);
  dHeap_.pushOrUpdate(goal, k1, k2);
  dsValid_ = true;
}

/// ComputeShortestPath: expand inconsistent vertices until the start is consistent and no
/// queued key is smaller than the start's key.
void DronePlanner::dsCompute() {
  while (!dHeap_.empty()) {
    int u = dHeap_.top();
    double sk1, sk2;
    dsCalcKey(dsStart_, sk1, sk2);
    double ok1 = dHeap_.key1(u), ok2 = dHeap_.key2(u);
    bool startKeyLarger = keyLess(ok1, ok2, sk1, sk2);
    if (!startKeyLarger && dRhs_[dsStart_] == dG_[dsStart_]) break;

    double nk1, nk2;
    dsCalcKey(u, nk1, nk2);
    if (keyLess(ok1, ok2, nk1, nk2)) {
      dHeap_.pushOrUpdate(u, nk1, nk2);  // key is stale because km grew: reinsert, no expansion
    } else if (dG_[u] > dRhs_[u]) {      // overconsistent: lock in the better value
      dG_[u] = dRhs_[u];
      dHeap_.remove(u);
      ++lastExpanded_;
      bumpHeat(u);
      dsUpdateNeighbors(u);
    } else {                             // underconsistent (cost went up): invalidate and repair
      dG_[u] = kInf;
      ++lastExpanded_;
      bumpHeat(u);
      dsUpdateVertex(u);
      dsUpdateNeighbors(u);
    }
  }
}

bool DronePlanner::runDStar(int start, int goal) {
  if (!dsValid_ || dsGoal_ != goal) {
    dsInit(start, goal);
  } else {
    // The drone moved: keep old keys comparable by raising km, then repair changed cells.
    dsKm_ += octile(dsLast_, start);
    dsLast_ = dsStart_ = start;
    for (int i = 0; i < pendingCount_; ++i) {
      int c = pending_[i];
      pendingFlag_[c] = 0;
      dsUpdateVertex(c);
      dsUpdateNeighbors(c);
    }
    pendingCount_ = 0;
  }
  dsCompute();
  if (dG_[start] == kInf) return false;

  // Extract the path by greedy descent on g. Costs are positive, so it cannot loop; the
  // length bound is only a guard.
  int len = 0, cur = start;
  double cost = 0.0;
  path_[len++] = cur;
  while (cur != goal && len < n_) {
    int cx = cur % w_, cy = cur / w_, bestV = -1;
    double bestVal = kInf, bestStep = 0.0;
    for (int d = 0; d < 8; ++d) {
      int v = stepTarget(cx, cy, d);
      if (v < 0) continue;
      double step = moveCost(d, v);
      if (step + dG_[v] < bestVal) { bestVal = step + dG_[v]; bestV = v; bestStep = step; }
    }
    if (bestV < 0 || bestVal == kInf) return false;
    cost += bestStep;
    cur = bestV;
    path_[len++] = cur;
  }
  if (cur != goal) return false;
  pathLen_ = len;
  pathCost_ = cost;
  return true;
}

// ------------------------------------------------------------------ LiDAR

/// Bresenham walk from (x0,y0) to (x1,y1); false if a wall lies strictly between them.
bool DronePlanner::lineOfSight(int x0, int y0, int x1, int y1) const {
  int dx = std::abs(x1 - x0), dy = -std::abs(y1 - y0);
  int sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  int err = dx + dy, x = x0, y = y0;
  for (;;) {
    int e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (x == x1 && y == y1) return true;
    if (grid_[y * w_ + x] == kWall) return false;
  }
}

bool DronePlanner::hasPathObstruction(int droneX, int droneY, int sensorRadius, int fromIndex) const {
  if (droneX < 0 || droneY < 0 || droneX >= w_ || droneY >= h_) return false;
  long r2 = static_cast<long>(sensorRadius) * sensorRadius;
  for (int i = std::max(fromIndex, 0); i < pathLen_; ++i) {
    int c = path_[i], cx = c % w_, cy = c / w_;
    if (grid_[c] != kWall) continue;
    long dx = cx - droneX, dy = cy - droneY;
    if (dx * dx + dy * dy > r2) continue;
    if (lineOfSight(droneX, droneY, cx, cy)) return true;
  }
  return false;
}
