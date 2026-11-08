// Sun, moon and star-field orientation. World frame is ENU: x = east, y = north, z = up.
import * as SunCalc from 'suncalc';
import { config } from './config';

export type Vec3 = [number, number, number];

export function dirFromAltAz(altDeg: number, azDeg: number): Vec3 {
  const alt = (altDeg * Math.PI) / 180;
  const az = (azDeg * Math.PI) / 180;
  return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
}

export function altOf(d: Vec3): number {
  return (Math.asin(Math.max(-1, Math.min(1, d[2]))) * 180) / Math.PI;
}

export interface Astro {
  sunDir: Vec3;
  moonDir: Vec3;
  /** Illuminated fraction of the moon, 0..1 (brightness only; the phase shape is lit from sunDir). */
  moonFraction: number;
  /** Column-major 3x3 matrix taking a world (ENU) direction to equatorial (RA/Dec) coordinates. */
  worldToEq: Float32Array;
}

function julianDate(d: Date): number {
  return d.getTime() / 86400000 + 2440587.5;
}

/** Local sidereal time in radians. */
function localSiderealTime(d: Date, lonDeg: number): number {
  const jd = julianDate(d);
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  return ((((gmst + lonDeg) % 360) + 360) % 360) * (Math.PI / 180);
}

export function computeAstro(date: Date): Astro {
  const { lat, lon } = config.location;
  const sun = SunCalc.getPosition(date, lat, lon);
  const moon = SunCalc.getMoonPosition(date, lat, lon);
  const illum = SunCalc.getMoonIllumination(date);

  // Equatorial -> ENU: v_enu = A * v_eq where A = M_lat * R(LST).
  const lst = localSiderealTime(date, lon);
  const phi = (lat * Math.PI) / 180;
  const cL = Math.cos(lst), sL = Math.sin(lst);
  const sp = Math.sin(phi), cp = Math.cos(phi);
  // Rows of R (eq -> hour-angle frame): X' = cL*X + sL*Y ; Y' = -sL*X + cL*Y ; Z' = Z
  // Columns of M_lat (hour-angle frame -> ENU): X' -> (0,-sp,cp), Y' -> (1,0,0), Z' -> (0,cp,sp)
  // A = M * R. worldToEq = A^T. Build A row-major then emit transpose column-major (= A row-major).
  const R = [
    [cL, sL, 0],
    [-sL, cL, 0],
    [0, 0, 1],
  ];
  const M = [
    [0, 1, 0],
    [-sp, 0, cp],
    [cp, 0, sp],
  ];
  const A: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) A[i][j] = M[i][0] * R[0][j] + M[i][1] * R[1][j] + M[i][2] * R[2][j];
  // GLSL mat3 is column-major. worldToEq = A^T, whose column j is row j of A.
  const worldToEq = new Float32Array([A[0][0], A[0][1], A[0][2], A[1][0], A[1][1], A[1][2], A[2][0], A[2][1], A[2][2]]);

  return {
    sunDir: dirFromAltAz(sun.altitude, sun.azimuth),
    moonDir: dirFromAltAz(moon.altitude, moon.azimuth),
    moonFraction: illum.fraction,
    worldToEq,
  };
}
