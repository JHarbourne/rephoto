import type { Pt } from "../types";

/**
 * Thin Plate Spline warping.
 *
 * We fit two TPS functions f_x, f_y over the *destination* (historic) space so
 * that for each control point `dst_i` they reproduce the matching `src_i`
 * (modern) coordinate. Evaluated over the output grid this yields, for every
 * output pixel, the source coordinate to sample from — exactly the mapping
 * `cv.remap` expects. This gives a smooth, non-linear warp that keeps rooflines
 * and window frames locked in place better than a single homography can.
 */

const U = (r2: number): number => {
  // Radial basis U(r) = r^2 * log(r) = 0.5 * r^2 * log(r^2). U(0) = 0.
  if (r2 <= 1e-12) return 0;
  return 0.5 * r2 * Math.log(r2);
};

export interface TPSModel {
  /** Control points in destination space. */
  dst: Pt[];
  /** Weights + affine terms for the x mapping. Length n+3. */
  wx: number[];
  /** Weights + affine terms for the y mapping. Length n+3. */
  wy: number[];
}

/** Solve A x = b for multiple right-hand sides via Gaussian elimination with
 * partial pivoting. `A` is n x n (row-major, mutated), `bs` is a list of RHS
 * vectors (each length n, mutated). Returns the solution vectors. */
function solveLinear(A: number[][], bs: number[][]): number[][] {
  const n = A.length;
  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let pivot = col;
    let best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (pivot !== col) {
      [A[col], A[pivot]] = [A[pivot], A[col]];
      for (const b of bs) [b[col], b[pivot]] = [b[pivot], b[col]];
    }
    const diag = A[col][col] || 1e-12;
    for (let r = col + 1; r < n; r++) {
      const factor = A[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= factor * A[col][c];
      for (const b of bs) b[r] -= factor * b[col];
    }
  }
  // Back substitution.
  const solutions: number[][] = bs.map(() => new Array(n).fill(0));
  for (let s = 0; s < bs.length; s++) {
    const b = bs[s];
    const x = solutions[s];
    for (let row = n - 1; row >= 0; row--) {
      let sum = b[row];
      for (let c = row + 1; c < n; c++) sum -= A[row][c] * x[c];
      x[row] = sum / (A[row][row] || 1e-12);
    }
  }
  return solutions;
}

/**
 * Fit a TPS model mapping destination points -> source points.
 * @param dst control points in destination (historic) space
 * @param src matching control points in source (modern) space
 * @param regularization optional smoothing (0 = exact interpolation)
 */
export function fitTPS(dst: Pt[], src: Pt[], regularization = 0): TPSModel {
  const n = dst.length;
  if (n < 3) throw new Error("TPS needs at least 3 control points");

  const size = n + 3;
  const A: number[][] = Array.from({ length: size }, () =>
    new Array(size).fill(0)
  );

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = dst[i].x - dst[j].x;
      const dy = dst[i].y - dst[j].y;
      A[i][j] = U(dx * dx + dy * dy);
    }
    A[i][i] += regularization;
    // P block.
    A[i][n] = 1;
    A[i][n + 1] = dst[i].x;
    A[i][n + 2] = dst[i].y;
    // P^T block.
    A[n][i] = 1;
    A[n + 1][i] = dst[i].x;
    A[n + 2][i] = dst[i].y;
  }

  const bx = new Array(size).fill(0);
  const by = new Array(size).fill(0);
  for (let i = 0; i < n; i++) {
    bx[i] = src[i].x;
    by[i] = src[i].y;
  }

  const [wx, wy] = solveLinear(A, [bx, by]);
  return { dst, wx, wy };
}

/** Evaluate the fitted TPS at a destination coordinate, returning the source
 * coordinate to sample. */
export function evalTPS(model: TPSModel, x: number, y: number): Pt {
  const { dst, wx, wy } = model;
  const n = dst.length;
  let sx = wx[n] + wx[n + 1] * x + wx[n + 2] * y;
  let sy = wy[n] + wy[n + 1] * x + wy[n + 2] * y;
  for (let i = 0; i < n; i++) {
    const dx = x - dst[i].x;
    const dy = y - dst[i].y;
    const u = U(dx * dx + dy * dy);
    sx += wx[i] * u;
    sy += wy[i] * u;
  }
  return { x: sx, y: sy };
}
