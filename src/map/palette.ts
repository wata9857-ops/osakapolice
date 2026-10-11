// Map colour palettes for light/dark themes.
import type { Theme } from '../ui/store';
import type { UnitStatus } from '../sim/types';

export interface MapPalette {
  bg: string;
  sea: string;
  water: string;
  waterLine: string;
  green: string;
  cityFill: string;
  wardLine: string;
  cityLine: string;
  wardLabel: string;
  rail: string;
  roads: { motorway: string; trunk: string; primary: string; secondary: string; tertiary: string; minor: string; living: string };
  casing: string;
  motorwayCasing: string;
  roadLabel: string;
  roadHalo: string;
  label: string;
  labelHalo: string;
  facility: string;
  facilityTx: string;
  koban: string;
  route: string;
  routeAlt: string;
  patrol: string;
  status: Record<UnitStatus, string>;
  pri: Record<number, string>;
  traffic: [string, string, string];
  suspect: string;
}

const STATUS_DARK: Record<UnitStatus, string> = {
  standby: '#8796a3', patrol: '#3fc38f', enroute: '#ffb000', onscene: '#ff4b4b', search: '#ff7c2a', pursuit: '#ff2fa0',
  transport: '#b18cff', office: '#5a6975', returning: '#4ea8ff', moving: '#31c8dc', hold: '#c6d266',
};
const STATUS_LIGHT: Record<UnitStatus, string> = {
  standby: '#6b7a86', patrol: '#138a5c', enroute: '#c47c00', onscene: '#d32020', search: '#d4560a', pursuit: '#c2127a',
  transport: '#7a4fd0', office: '#8a97a1', returning: '#1565c0', moving: '#0a8fa3', hold: '#7c8a12',
};

export const PALETTES: Record<Theme, MapPalette> = {
  dark: {
    bg: '#0c1217',
    sea: '#08182a',
    water: '#0b2034',
    waterLine: '#123150',
    green: '#0e1b16',
    cityFill: '#0f161c',
    wardLine: '#2a3a48',
    cityLine: '#4a5e70',
    wardLabel: '#3f5263',
    rail: '#3a4652',
    roads: { motorway: '#6e5520', trunk: '#3f4e5c', primary: '#3a4856', secondary: '#313e4a', tertiary: '#2a3540', minor: '#1e2830', living: '#1a232a' },
    casing: '#0c1217',
    motorwayCasing: '#3d2f10',
    roadLabel: '#8394a2',
    roadHalo: '#0c1217',
    label: '#c9d4dc',
    labelHalo: '#0a0f13',
    facility: '#4ea8ff',
    facilityTx: '#06121e',
    koban: '#6aa9d8',
    route: '#ffb000',
    routeAlt: '#4ea8ff',
    patrol: '#3fc38f',
    status: STATUS_DARK,
    pri: { 1: '#ff3d3d', 2: '#ff8a1f', 3: '#e9c34a', 4: '#8d9eac' },
    traffic: ['#2fa36b', '#d9a400', '#e0402f'],
    suspect: '#ff2fa0',
  },
  light: {
    bg: '#eceeea',
    sea: '#b4cde0',
    water: '#bad2e6',
    waterLine: '#93b7d4',
    green: '#d3e3cc',
    cityFill: '#f3f4f1',
    wardLine: '#a9b3bb',
    cityLine: '#6f7d88',
    wardLabel: '#8b98a3',
    rail: '#9aa4ad',
    roads: { motorway: '#f0b155', trunk: '#ffe0a3', primary: '#ffffff', secondary: '#ffffff', tertiary: '#ffffff', minor: '#ffffff', living: '#f7f7f5' },
    casing: '#c3cad0',
    motorwayCasing: '#c4822a',
    roadLabel: '#4e5a64',
    roadHalo: '#ffffff',
    label: '#1d262d',
    labelHalo: '#ffffff',
    facility: '#1565c0',
    facilityTx: '#ffffff',
    koban: '#3f7fb8',
    route: '#c45f00',
    routeAlt: '#1565c0',
    patrol: '#138a5c',
    status: STATUS_LIGHT,
    pri: { 1: '#d71e1e', 2: '#d86400', 3: '#a8840a', 4: '#6b7c89' },
    traffic: ['#1e9a5e', '#d79b00', '#d1301f'],
    suspect: '#c2127a',
  },
};
