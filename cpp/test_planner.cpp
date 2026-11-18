// Standalone tests for DronePlanner (no framework).
// Build: g++ -std=c++17 -Wall -Wextra -Wpedantic cpp/test_planner.cpp cpp/planner.cpp -o test_planner
#include "planner.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

static const double kSqrt2 = 1.4142135623730951;
static const double kInf = std::numeric_limits<double>::infinity();

static bool g_failed = false;
#define CHECK(cond)                                                       \
  do {                                                                    \
    if (!(cond)) {                                                        \
      std::printf("    CHECK failed: %s (line %d)\n", #cond, __LINE__);   \
      g_failed = true;                                                    \
    }                                                                     \
  } while (0)

static bool near(double a, double b, double eps = 1e-9) { return std::fabs(a - b) <= eps; }

/// Small deterministic LCG so the random tests are reproducible everywhere.
struct Rng {
  uint32_t s;
  explicit Rng(uint32_t seed) : s(seed) {}
  uint32_t next() { s = s * 1664525u + 1013904223u; return s >> 8; }
  int range(int n) { return static_cast<int>(next() % static_cast<uint32_t>(n)); }
};

static void fillRandom(DronePlanner& p, Rng& r, int wallPct, int windPct) {
  for (int y = 0; y < p.height(); ++y)
    for (int x = 0; x < p.width(); ++x) {
      int roll = r.range(100);
      p.setCell(x, y, roll < wallPct ? 1 : (roll < wallPct + windPct ? 2 : 0));
    }
}

static void copyGrid(const DronePlanner& from, DronePlanner& to) {
  for (int y = 0; y < from.height(); ++y)
    for (int x = 0; x < from.width(); ++x) to.setCell(x, y, from.getCell(x, y));
}

static void pickFree(const DronePlanner& p, Rng& r, int& x, int& y) {
  do { x = r.range(p.width()); y = r.range(p.height()); } while (p.getCell(x, y) == 1);
}

/// Independent O(N^2) Dijkstra used as ground truth. Written separately from the planner on purpose.
static double refCost(const DronePlanner& p, int sx, int sy, int gx, int gy) {
  const int w = p.width(), h = p.height(), n = w * h;
  std::vector<double> dist(n, kInf);
  std::vector<char> done(n, 0);
  dist[sy * w + sx] = 0;
  for (int iter = 0; iter < n; ++iter) {
    int u = -1;
    for (int i = 0; i < n; ++i)
      if (!done[i] && dist[i] < kInf && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = 1;
    int ux = u % w, uy = u / w;
    for (int dy = -1; dy <= 1; ++dy)
      for (int dx = -1; dx <= 1; ++dx) {
        if (!dx && !dy) continue;
        int vx = ux + dx, vy = uy + dy;
        if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
        int cell = p.getCell(vx, vy);
        if (cell == 1) continue;
        if (dx && dy && (p.getCell(ux + dx, uy) == 1 || p.getCell(ux, uy + dy) == 1)) continue;
        double c = ((dx && dy) ? kSqrt2 : 1.0) * (cell == 2 ? 4.0 : 1.0);
        if (dist[u] + c < dist[vy * w + vx]) dist[vy * w + vx] = dist[u] + c;
      }
  }
  double d = dist[gy * w + gx];
  return d == kInf ? -1.0 : d;
}

/// Checks that the stored path is a legal walk from start to goal and that its cost matches.
static bool pathValid(const DronePlanner& p, int sx, int sy, int gx, int gy) {
  const int w = p.width(), len = p.getPathLength();
  const int32_t* path = p.pathData();
  if (len < 1 || path[0] != sy * w + sx || path[len - 1] != gy * w + gx) return false;
  double cost = 0;
  for (int i = 1; i < len; ++i) {
    int ax = path[i - 1] % w, ay = path[i - 1] / w, bx = path[i] % w, by = path[i] / w;
    int dx = bx - ax, dy = by - ay;
    if (std::abs(dx) > 1 || std::abs(dy) > 1 || (!dx && !dy)) return false;
    int cell = p.getCell(bx, by);
    if (cell == 1) return false;
    if (dx && dy && (p.getCell(ax + dx, ay) == 1 || p.getCell(ax, ay + dy) == 1)) return false;
    cost += ((dx && dy) ? kSqrt2 : 1.0) * (cell == 2 ? 4.0 : 1.0);
  }
  return near(cost, p.getPathCost(), 1e-6);
}

// ---------------------------------------------------------------- tests

static void testStraightCost() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(20, 5);
    CHECK(p.computePath(0, 2, 10, 2, mode));
    CHECK(near(p.getPathCost(), 10.0));
    CHECK(p.getPathLength() == 11);
    CHECK(pathValid(p, 0, 2, 10, 2));
  }
}

static void testDiagonalCost() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(20, 20);
    CHECK(p.computePath(0, 0, 5, 5, mode));
    CHECK(near(p.getPathCost(), 5 * kSqrt2));
    CHECK(p.getPathLength() == 6);
    CHECK(p.computePath(0, 0, 5, 2, mode));
    CHECK(near(p.getPathCost(), 3.0 + 2 * kSqrt2));
  }
}

static void testStartEqualsGoal() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(10, 10);
    CHECK(p.computePath(3, 3, 3, 3, mode));
    CHECK(p.getPathLength() == 1);
    CHECK(near(p.getPathCost(), 0.0));
  }
}

static void testNoCornerCutting() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(3, 3);
    p.setCell(1, 0, 1);  // one orthogonal neighbor of the diagonal (0,0)->(1,1)
    CHECK(p.computePath(0, 0, 1, 1, mode));
    CHECK(near(p.getPathCost(), 2.0));  // must go (0,0)->(0,1)->(1,1)
    p.setCell(0, 1, 1);                 // now the start is sealed in
    CHECK(!p.computePath(0, 0, 1, 1, mode));
  }
}

static void testWindAvoidedWhenDetourCheaper() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(11, 3);
    for (int x = 4; x <= 6; ++x) p.setCell(x, 1, 2);
    CHECK(p.computePath(0, 1, 10, 1, mode));
    CHECK(near(p.getPathCost(), 8.0 + 2 * kSqrt2));  // 2 diagonals + 8 straight, no wind
    for (int i = 0; i < p.getPathLength(); ++i) CHECK(p.getCell(p.pathData()[i] % 11, p.pathData()[i] / 11) != 2);
  }
}

static void testWindCrossedWhenDetourCostlier() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(11, 21);
    for (int y = 0; y < 20; ++y) p.setCell(5, y, 2);  // gap only at y = 20
    CHECK(p.computePath(0, 0, 10, 0, mode));
    CHECK(near(p.getPathCost(), 9.0 + 4.0));  // nine free cells, one wind cell at 4x
    CHECK(pathValid(p, 0, 0, 10, 0));
  }
}

static void testRandomMapsAgree() {
  Rng rng(12345);
  for (int m = 0; m < 50; ++m) {
    DronePlanner a(16, 12), d(16, 12);
    fillRandom(a, rng, 25, 10);
    copyGrid(a, d);
    int sx, sy, gx, gy;
    pickFree(a, rng, sx, sy);
    pickFree(a, rng, gx, gy);
    bool fa = a.computePath(sx, sy, gx, gy, 0);
    bool fd = d.computePath(sx, sy, gx, gy, 1);
    double ref = refCost(a, sx, sy, gx, gy);
    CHECK(fa == fd);
    CHECK(fa == (ref >= 0));
    if (fa) {
      CHECK(near(a.getPathCost(), d.getPathCost(), 1e-6));
      CHECK(near(a.getPathCost(), ref, 1e-6));
      CHECK(pathValid(a, sx, sy, gx, gy));
      CHECK(pathValid(d, sx, sy, gx, gy));
    } else {
      CHECK(a.getPathCost() == -1.0 && d.getPathCost() == -1.0);
    }
  }
}

static void testDStarReplanAfterBlock() {
  DronePlanner d(100, 100), ref(100, 100);
  const int sx = 5, sy = 5, gx = 95, gy = 70;
  CHECK(d.computePath(sx, sy, gx, gy, 1));
  const int firstExpanded = d.getLastExpandedCount();
  // Drop a 7-cell wall across the active route, 15 steps before the goal.
  int cell = d.pathData()[d.getPathLength() - 15];
  int cx = cell % 100, cy = cell / 100;
  for (int y = cy - 3; y <= cy + 3; ++y) { d.setCell(cx, y, 1); ref.setCell(cx, y, 1); }
  CHECK(d.computePath(sx, sy, gx, gy, 1));
  CHECK(ref.computePath(sx, sy, gx, gy, 0));
  CHECK(near(d.getPathCost(), ref.getPathCost(), 1e-6));
  CHECK(pathValid(d, sx, sy, gx, gy));
  std::printf("    info: D* initial=%d repair=%d, fresh A*=%d\n", firstExpanded,
              d.getLastExpandedCount(), ref.getLastExpandedCount());
  CHECK(d.getLastExpandedCount() < ref.getLastExpandedCount());
  CHECK(d.getLastExpandedCount() < firstExpanded);
}

static void testDStarStartMoves() {
  Rng rng(777);
  DronePlanner d(60, 60), ref(60, 60);
  fillRandom(d, rng, 15, 5);
  copyGrid(d, ref);
  const int gx = 55, gy = 55;
  d.setCell(2, 2, 0);
  d.setCell(gx, gy, 0);
  ref.setCell(2, 2, 0);
  ref.setCell(gx, gy, 0);
  CHECK(d.computePath(2, 2, gx, gy, 1));
  const int initial = d.getLastExpandedCount();
  for (int step = 0; step < 3; ++step) {
    int cell = d.pathData()[10];  // the drone advances 10 cells along its path
    int sx = cell % 60, sy = cell / 60;
    CHECK(d.computePath(sx, sy, gx, gy, 1));
    CHECK(ref.computePath(sx, sy, gx, gy, 0));
    CHECK(near(d.getPathCost(), ref.getPathCost(), 1e-6));
    CHECK(pathValid(d, sx, sy, gx, gy));
    CHECK(d.getLastExpandedCount() < initial);
  }
}

static void testDStarRandomEdits() {
  Rng rng(2024);
  for (int m = 0; m < 30; ++m) {
    DronePlanner d(20, 15), ref(20, 15);
    fillRandom(d, rng, 20, 10);
    copyGrid(d, ref);
    int sx, sy, gx, gy;
    pickFree(d, rng, sx, sy);
    pickFree(d, rng, gx, gy);
    for (int round = 0; round < 6; ++round) {
      bool fd = d.computePath(sx, sy, gx, gy, 1);
      bool fr = ref.computePath(sx, sy, gx, gy, 0);
      CHECK(fd == fr);
      if (fd && fr) CHECK(near(d.getPathCost(), ref.getPathCost(), 1e-6));
      if (fd) CHECK(pathValid(d, sx, sy, gx, gy));
      for (int e = 0; e < 8; ++e) {  // random edits, never on the endpoints
        int x = rng.range(20), y = rng.range(15), v = rng.range(3);
        if ((x == sx && y == sy) || (x == gx && y == gy)) continue;
        d.setCell(x, y, v);
        ref.setCell(x, y, v);
      }
      if (fd && d.getPathLength() > 3) {  // drone moves a couple of steps
        int c = d.pathData()[2];
        sx = c % 20;
        sy = c / 20;
      }
    }
  }
}

static void testUnreachableGoal() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(10, 10);
    for (int x = 6; x <= 8; ++x)
      for (int y = 6; y <= 8; ++y)
        if (x != 7 || y != 7) p.setCell(x, y, 1);  // ring around (7,7)
    CHECK(!p.computePath(0, 0, 7, 7, mode));
    CHECK(p.getPathCost() == -1.0);
    CHECK(p.getPathLength() == 0);
  }
}

static void testBadEndpoints() {
  for (int mode = 0; mode < 2; ++mode) {
    DronePlanner p(10, 10);
    p.setCell(5, 5, 1);
    CHECK(!p.computePath(0, 0, 5, 5, mode));  // goal on wall
    CHECK(p.getPathCost() == -1.0);
    CHECK(!p.computePath(5, 5, 0, 0, mode));  // start on wall
    CHECK(!p.computePath(-1, 0, 3, 3, mode));  // out of range
    CHECK(!p.computePath(0, 0, 10, 3, mode));
    CHECK(p.computePath(0, 0, 3, 3, mode));  // still usable afterwards
  }
}

static void testSetCellRange() {
  DronePlanner p(8, 6);
  p.setCell(-1, 0, 1);
  p.setCell(8, 0, 1);
  p.setCell(0, 6, 1);
  p.setCell(0, -3, 1);
  p.setCell(2, 2, 7);  // invalid value ignored
  int walls = 0;
  for (int y = 0; y < 6; ++y)
    for (int x = 0; x < 8; ++x) walls += p.getCell(x, y) != 0;
  CHECK(walls == 0);
  p.setCell(7, 5, 2);
  CHECK(p.getCell(7, 5) == 2);
  CHECK(p.getCell(-1, 0) == 1);  // out of range reads as wall
}

static void testObstructionDetection() {
  DronePlanner p(20, 10);
  CHECK(p.computePath(0, 5, 10, 5, 0));
  CHECK(!p.hasPathObstruction(0, 5, 10, 0));  // clear path
  p.setCell(6, 5, 1);                          // wall appears on the route
  CHECK(p.hasPathObstruction(0, 5, 10, 0));
  CHECK(!p.hasPathObstruction(0, 5, 4, 0));    // outside the sensor radius
  CHECK(p.hasPathObstruction(0, 5, 6, 0));     // exactly on the radius
  CHECK(!p.hasPathObstruction(0, 5, 10, 8));   // only path cells from index 8 on are checked
}

static void testObstructionOccluded() {
  DronePlanner p(20, 10);
  CHECK(p.computePath(0, 5, 10, 5, 0));
  p.setCell(8, 5, 1);   // wall on the path ...
  p.setCell(8, 3, 1);   // ... hidden from a drone at (8,0) by this wall off the path
  CHECK(!p.hasPathObstruction(8, 0, 12, 0));
  p.setCell(8, 3, 0);
  CHECK(p.hasPathObstruction(8, 0, 12, 0));  // same query, now in line of sight
}

static void testHeatBuffer() {
  DronePlanner p(30, 30);
  for (int y = 0; y < 30; ++y) p.setCell(15, y, y == 29 ? 0 : 1);  // wall with a gap at the bottom
  CHECK(p.computePath(2, 2, 4, 4, 0));
  long total = 0;
  const uint8_t* heat = p.heatData();
  for (int i = 0; i < 900; ++i) {
    total += heat[i];
    if (p.getCell(i % 30, i / 30) == 1) CHECK(heat[i] == 0);
  }
  CHECK(total == p.getLastExpandedCount());  // A* expands each cell at most once
  CHECK(heat[2 * 30 + 2] == 1);
  CHECK(heat[29 * 30 + 29] == 0);            // far corner never reached
  // A new search resets the buffer.
  CHECK(p.computePath(28, 28, 27, 28, 0));
  CHECK(heat[2 * 30 + 2] == 0);
  CHECK(heat[28 * 30 + 28] == 1);
}

static void testTelemetryAndClear() {
  DronePlanner p(12, 12);
  CHECK(p.getReplanCount() == 0);
  CHECK(p.getPathCost() == -1.0 && p.getPathLength() == 0);
  p.setCell(3, 3, 1);
  p.computePath(0, 0, 9, 9, 0);
  p.computePath(0, 0, 9, 9, 1);
  CHECK(p.getReplanCount() == 2);
  CHECK(p.getLastExpandedCount() > 0);
  CHECK(p.getLastReplanMs() >= 0.0);
  p.clearGrid();
  CHECK(p.getReplanCount() == 0);
  CHECK(p.getCell(3, 3) == 0);
  CHECK(p.getPathLength() == 0);
  CHECK(p.computePath(0, 0, 9, 9, 1));  // D* state was reset, still works
  CHECK(near(p.getPathCost(), 9 * kSqrt2));
}

/// Writes the Urban Canyon preset (web/src/scenarios/presets.ts) into `p` cell by cell,
/// the way the web simulation does after clearGrid.
static void loadUrbanCanyon(DronePlanner& p) {
  const int w = 48, h = 30, mid = h / 2;
  auto rect = [&](int x0, int y0, int x1, int y1, int v) {
    for (int y = y0; y <= y1; ++y)
      for (int x = x0; x <= x1; ++x) p.setCell(x, y, v);
  };
  for (int i = 0; i < 5; ++i) {
    int x0 = 6 + i * 8;
    rect(x0, 2, x0 + 4, mid - 5, 1);
    rect(x0, mid + 4, x0 + 4, h - 3, 1);
  }
  rect(22, mid - 4, 25, mid + 3, 2);
  rect(11, 2, 13, mid - 5, 2);
  rect(35, mid + 4, 37, h - 3, 2);
  rect(16, mid - 4, 16, mid, 1);
  rect(30, mid, 30, mid + 3, 1);
  (void)w;
}

/// Applies the same edit to both planners and checks that D* Lite (mode 1) agrees with a
/// fresh A* (mode 0) on reachability and cost for the given start.
static void compareFromStart(DronePlanner& d, DronePlanner& ref, int sx, int sy, int gx, int gy) {
  bool fd = d.computePath(sx, sy, gx, gy, 1);
  bool fr = ref.computePath(sx, sy, gx, gy, 0);
  CHECK(fd == fr);
  if (fd && fr) {
    CHECK(near(d.getPathCost(), ref.getPathCost(), 1e-6));
    CHECK(pathValid(d, sx, sy, gx, gy));
  }
}

/// Replays what the web simulation does: load a preset after clearGrid, plan with D* Lite,
/// let the drone advance along the path (start changes between calls), then drag a vertical
/// wall across the route with repeated setCell calls and a replan between mouse events.
static void testUrbanCanyonDragRegression() {
  DronePlanner d(48, 30), ref(48, 30);
  loadUrbanCanyon(d);
  loadUrbanCanyon(ref);
  const int gx = 45, gy = 15;
  int sx = 2, sy = 15;
  compareFromStart(d, ref, sx, sy, gx, gy);
  for (int step = 0; step < 6; ++step) {  // drone advances ~4 cells per replan
    int pl = d.getPathLength();
    if (pl < 6) break;
    int c = d.pathData()[4];
    sx = c % 48;
    sy = c / 48;
    compareFromStart(d, ref, sx, sy, gx, gy);
  }
  // Drag a wall at x = 38 from y = 7 to y = 22; each event repeats the same cell and replans.
  for (int y = 7; y <= 22; ++y) {
    for (int rep = 0; rep < 3; ++rep) {
      if (38 == gx && y == gy) continue;
      d.setCell(38, y, 1);
      ref.setCell(38, y, 1);
      compareFromStart(d, ref, sx, sy, gx, gy);
      if (d.getPathLength() > 4 && rep == 2) {  // drone keeps moving during the drag
        int c = d.pathData()[1];
        sx = c % 48;
        sy = c / 48;
      }
    }
  }
}

/// Exact call sequence captured from the web simulation (Urban Canyon, D* Lite, drone moves
/// from (2,15) to (18,16) in one jump, then a wall is dragged into the gap at x = 38).
static void testUrbanCanyonSimReplay() {
  DronePlanner d(48, 30), ref(48, 30);
  loadUrbanCanyon(d);
  loadUrbanCanyon(ref);
  CHECK(d.computePath(2, 15, 45, 15, 0));
  compareFromStart(d, ref, 2, 15, 45, 15);
  for (int y = 11; y <= 18; ++y) {
    d.setCell(38, y, 1);
    ref.setCell(38, y, 1);
    compareFromStart(d, ref, 18, 16, 45, 15);
    compareFromStart(d, ref, 18, 16, 45, 15);
  }
}

/// Differential test: after every call D* Lite must match a fresh A*. Edits include repeated
/// sets of one cell, set-then-restore before the next call, bursts of many edits, and start
/// jumps of several cells.
static void testDStarDifferentialStress() {
  Rng rng(99);
  for (int m = 0; m < 40; ++m) {
    const int W = 24, H = 16;
    DronePlanner d(W, H), ref(W, H);
    fillRandom(d, rng, 22, 8);
    copyGrid(d, ref);
    int sx, sy, gx, gy;
    pickFree(d, rng, sx, sy);
    pickFree(d, rng, gx, gy);
    for (int round = 0; round < 40; ++round) {
      int edits = rng.range(12);
      for (int e = 0; e < edits; ++e) {
        int x = rng.range(W), y = rng.range(H), v = rng.range(3);
        if ((x == sx && y == sy) || (x == gx && y == gy)) continue;
        int kind = rng.range(3);
        int old = d.getCell(x, y);
        int reps = kind == 0 ? 1 + rng.range(5) : 1;
        for (int r = 0; r < reps; ++r) { d.setCell(x, y, v); ref.setCell(x, y, v); }
        if (kind == 1) { d.setCell(x, y, old); ref.setCell(x, y, old); }  // set then restore
      }
      compareFromStart(d, ref, sx, sy, gx, gy);
      if (d.getPathLength() > 1) {  // start jumps up to 6 cells along the path
        int k = std::min(d.getPathLength() - 1, 1 + rng.range(6));
        int c = d.pathData()[k];
        sx = c % W;
        sy = c / W;
      }
    }
  }
}

struct TestCase { const char* name; void (*fn)(); };

int main() {
  const TestCase tests[] = {
      {"straight optimal cost", testStraightCost},
      {"diagonal optimal cost", testDiagonalCost},
      {"start equals goal", testStartEqualsGoal},
      {"no corner cutting", testNoCornerCutting},
      {"wind avoided when detour cheaper", testWindAvoidedWhenDetourCheaper},
      {"wind crossed when detour costlier", testWindCrossedWhenDetourCostlier},
      {"A* == D* Lite == Dijkstra on 50 random maps", testRandomMapsAgree},
      {"D* Lite replan after wall blocks route", testDStarReplanAfterBlock},
      {"D* Lite after start moves", testDStarStartMoves},
      {"D* Lite random edits match fresh A*", testDStarRandomEdits},
      {"unreachable goal", testUnreachableGoal},
      {"goal/start on wall and out of range", testBadEndpoints},
      {"setCell range handling", testSetCellRange},
      {"hasPathObstruction true/false", testObstructionDetection},
      {"hasPathObstruction occluded by wall", testObstructionOccluded},
      {"heat buffer only at expanded cells", testHeatBuffer},
      {"telemetry and clearGrid", testTelemetryAndClear},
      {"D* Lite Urban Canyon drag regression", testUrbanCanyonDragRegression},
      {"D* Lite Urban Canyon simulation replay", testUrbanCanyonSimReplay},
      {"D* Lite differential stress vs fresh A*", testDStarDifferentialStress},
  };
  int failures = 0;
  for (const TestCase& t : tests) {
    g_failed = false;
    t.fn();
    std::printf("%s: %s\n", g_failed ? "FAIL" : "PASS", t.name);
    if (g_failed) ++failures;
  }
  std::printf("%d/%d tests passed\n", static_cast<int>(sizeof(tests) / sizeof(tests[0])) - failures,
              static_cast<int>(sizeof(tests) / sizeof(tests[0])));
  return failures == 0 ? 0 : 1;
}
