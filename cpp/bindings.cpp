/// @file bindings.cpp
/// Embind glue exposing DronePlanner to JavaScript.
///
/// The three view methods return typed arrays that alias the planner's own buffers via
/// emscripten::typed_memory_view: no copy per frame. The planner never reallocates after
/// construction, so views stay valid unless Wasm memory itself grows (then re-fetch them).
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "planner.hpp"

using emscripten::val;

namespace {

val gridView(const DronePlanner& p) {
  return val(emscripten::typed_memory_view(static_cast<size_t>(p.width()) * p.height(), p.gridData()));
}
val heatView(const DronePlanner& p) {
  return val(emscripten::typed_memory_view(static_cast<size_t>(p.width()) * p.height(), p.heatData()));
}
val pathView(const DronePlanner& p) {
  return val(emscripten::typed_memory_view(static_cast<size_t>(p.width()) * p.height(), p.pathData()));
}

}  // namespace

EMSCRIPTEN_BINDINGS(drone_planner) {
  emscripten::class_<DronePlanner>("DronePlanner")
      .constructor<int, int>()
      .function("setCell", &DronePlanner::setCell)
      .function("getCell", &DronePlanner::getCell)
      .function("clearGrid", &DronePlanner::clearGrid)
      .function("computePath", &DronePlanner::computePath)
      .function("hasPathObstruction", &DronePlanner::hasPathObstruction)
      .function("getLastExpandedCount", &DronePlanner::getLastExpandedCount)
      .function("getLastReplanMs", &DronePlanner::getLastReplanMs)
      .function("getPathCost", &DronePlanner::getPathCost)
      .function("getPathLength", &DronePlanner::getPathLength)
      .function("getReplanCount", &DronePlanner::getReplanCount)
      .function("width", &DronePlanner::width)
      .function("height", &DronePlanner::height)
      .function("getGridView", &gridView)
      .function("getHeatView", &heatView)
      .function("getPathView", &pathView);
}
