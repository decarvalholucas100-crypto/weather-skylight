// The brightest stars visible from New York: [RA hours, Dec degrees, visual magnitude, B-V color].
// Positions are J2000 (precession over a few decades is far below what the display can resolve).
// Under NYC light pollution only stars brighter than ~magnitude 3-3.5 show, so this short list
// gives real, recognizable constellations: Orion, the Big Dipper, Cassiopeia, the Summer Triangle.
// Star positions are facts, not copyrightable data.
export const BRIGHT_STARS: [number, number, number, number][] = [
  [6.752, -16.716, -1.46, 0.0], // Sirius
  [14.261, 19.182, -0.05, 1.23], // Arcturus
  [18.616, 38.784, 0.03, 0.0], // Vega
  [5.278, 45.998, 0.08, 0.8], // Capella
  [5.242, -8.202, 0.13, -0.03], // Rigel
  [7.655, 5.225, 0.34, 0.42], // Procyon
  [5.919, 7.407, 0.5, 1.85], // Betelgeuse
  [19.846, 8.868, 0.76, 0.22], // Altair
  [4.599, 16.509, 0.86, 1.54], // Aldebaran
  [16.49, -26.432, 0.96, 1.83], // Antares
  [13.42, -11.161, 0.97, -0.23], // Spica
  [7.755, 28.026, 1.14, 1.0], // Pollux
  [22.961, -29.622, 1.16, 0.09], // Fomalhaut
  [20.69, 45.28, 1.25, 0.09], // Deneb
  [10.14, 11.967, 1.35, -0.11], // Regulus
  [6.977, -28.972, 1.5, -0.21], // Adhara
  [7.577, 31.888, 1.58, 0.03], // Castor
  [5.419, 6.35, 1.64, -0.22], // Bellatrix
  [5.438, 28.608, 1.65, -0.13], // Elnath
  [5.604, -1.202, 1.69, -0.18], // Alnilam
  [5.679, -1.943, 1.74, -0.21], // Alnitak
  [5.533, -0.299, 2.23, -0.22], // Mintaka
  [5.796, -9.67, 2.06, -0.17], // Saiph
  [5.585, 9.934, 3.33, -0.18], // Meissa
  [12.9, 55.96, 1.76, -0.02], // Alioth
  [11.062, 61.751, 1.79, 1.07], // Dubhe
  [11.031, 56.383, 2.37, -0.02], // Merak
  [11.897, 53.695, 2.44, 0.04], // Phecda
  [12.257, 57.033, 3.31, 0.08], // Megrez
  [13.399, 54.925, 2.23, 0.02], // Mizar
  [13.792, 49.313, 1.85, -0.19], // Alkaid
  [3.405, 49.861, 1.79, 0.48], // Mirfak
  [7.14, -26.393, 1.83, 0.68], // Wezen
  [18.403, -34.385, 1.85, -0.03], // Kaus Australis
  [6.629, 16.399, 1.93, 0.0], // Alhena
  [2.53, 89.264, 1.98, 0.6], // Polaris
  [6.378, -17.956, 1.98, -0.24], // Mirzam
  [9.46, -8.659, 1.98, 1.44], // Alphard
  [2.12, 23.462, 2.0, 1.15], // Hamal
  [1.911, 20.808, 2.64, 0.13], // Sheratan
  [0.727, -17.987, 2.04, 1.02], // Diphda
  [18.921, -26.297, 2.05, -0.13], // Nunki
  [17.582, 12.56, 2.08, 0.15], // Rasalhague
  [17.725, 4.567, 2.77, 1.16], // Cebalrai
  [0.14, 29.091, 2.06, -0.11], // Alpheratz
  [1.163, 35.621, 2.05, 1.58], // Mirach
  [2.065, 42.33, 2.1, 1.37], // Almach
  [0.655, 30.861, 3.27, 1.28], // Delta And
  [14.845, 74.155, 2.08, 1.47], // Kochab
  [15.345, 71.834, 3.0, 0.05], // Pherkad
  [11.818, 14.572, 2.14, 0.09], // Denebola
  [11.235, 20.524, 2.56, 0.12], // Zosma
  [10.333, 19.842, 2.08, 1.15], // Algieba
  [9.764, 23.774, 2.98, 0.8], // Ras Elased
  [3.136, 40.956, 2.12, -0.05], // Algol
  [0.675, 56.537, 2.24, 1.17], // Schedar
  [0.153, 59.15, 2.28, 0.34], // Caph
  [0.945, 60.717, 2.47, -0.15], // Gamma Cas
  [1.43, 60.235, 2.68, 0.13], // Ruchbah
  [1.907, 63.67, 3.37, -0.15], // Segin
  [20.37, 40.257, 2.23, 0.67], // Sadr
  [20.77, 33.97, 2.48, 1.03], // Gienah (Cyg)
  [19.75, 45.131, 2.87, -0.03], // Delta Cyg
  [19.512, 27.96, 3.08, 1.13], // Albireo
  [19.771, 10.613, 2.72, 1.52], // Tarazed
  [17.943, 51.489, 2.24, 1.52], // Eltanin
  [17.507, 52.301, 2.79, 0.98], // Rastaban
  [15.578, 26.715, 2.23, -0.02], // Alphecca
  [5.992, 44.947, 1.9, 0.08], // Menkalinan
  [5.995, 37.213, 2.62, -0.08], // Theta Aur
  [21.736, 9.875, 2.38, 1.52], // Enif
  [23.063, 28.083, 2.42, 1.67], // Scheat
  [23.079, 15.205, 2.49, -0.04], // Markab
  [0.22, 15.184, 2.83, -0.23], // Algenib
  [21.31, 62.586, 2.45, 0.26], // Alderamin
  [21.477, 70.561, 3.23, -0.22], // Alfirk
  [3.038, 4.09, 2.54, 1.64], // Menkar
  [15.283, -9.383, 2.61, -0.11], // Zubeneschamali
  [15.738, 6.426, 2.63, 1.17], // Unukalhai
  [17.173, -15.725, 2.43, 0.06], // Sabik
  [16.006, -22.622, 2.29, -0.12], // Dschubba
  [14.75, 27.074, 2.37, 0.97], // Izar
  [13.911, 18.398, 2.68, 0.58], // Muphrid
  [12.934, 38.318, 2.89, -0.12], // Cor Caroli
  [16.504, 21.49, 2.77, 0.94], // Kornephoros
  [16.688, 31.603, 2.81, 0.65], // Zeta Her
  [13.036, 10.959, 2.83, 0.94], // Vindemiatrix
  [12.263, -17.542, 2.59, -0.11], // Gienah (Crv)
  [6.383, 22.514, 2.87, 1.64], // Tejat
  [3.791, 24.105, 2.87, -0.09], // Alcyone (Pleiades)
  [3.819, 24.053, 3.62, -0.07], // Atlas
  [3.747, 24.113, 3.7, -0.11], // Electra
  [3.763, 24.368, 3.87, -0.07], // Maia
  [4.477, 19.181, 3.53, 0.98], // Ain (Hyades)
  [22.096, -0.32, 2.94, 0.98], // Sadalmelik
  [21.526, -5.571, 2.87, 0.83], // Sadalsuud
  [21.784, -16.127, 2.81, 0.29], // Deneb Algedi
];

/** Pack stars into a vertex buffer: [eqX, eqY, eqZ, mag, bv] per star, plus faint random fill stars. */
export function buildStarBuffer(): { data: Float32Array; count: number } {
  const rows: number[] = [];
  for (const [ra, dec, mag, bv] of BRIGHT_STARS) {
    const a = (ra / 24) * Math.PI * 2;
    const d = (dec * Math.PI) / 180;
    rows.push(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d), mag, bv);
  }
  // Faint background stars (mag 3.5-6.5), only visible with low light pollution settings.
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 1400; i++) {
    const z = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    const mag = 3.5 + 3 * Math.pow(rnd(), 0.45);
    rows.push(r * Math.cos(th), r * Math.sin(th), z, mag, rnd() * 1.6 - 0.2);
  }
  return { data: new Float32Array(rows), count: rows.length / 5 };
}
