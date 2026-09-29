import ma from './ma.js';
import nj from './nj.js';
import or from './or.js';
import ga from './ga.js';
import ia from './ia.js';
import la from './la.js';

export const PORTALS = [ma, nj, or, ga, ia, la];
export const PORTAL_BY_KEY = Object.fromEntries(PORTALS.map((p) => [p.key, p]));
export const ALL_PORTAL_KEYS = PORTALS.map((p) => p.key);
