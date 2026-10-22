import { useQuery } from '@tanstack/react-query';

import { getHotelRooms, getHotelsView, type RoomRow } from '../adminClient';
import stand from './data/standRooms.json';

/**
 * ДАННЫЕ МАКЕТОВ (партия 63-М).
 *
 * Номера — живые: локальные отели через ручку чтения, Метрополь и Сиалия —
 * снимком со стенда (`data/standRooms.json`, только GET выкаченным кодом,
 * PIN — только «есть / нет»). Чего в данных нет, то — ОБРАЗЕЦ и так и
 * помечено на экране: этаж и позиция, выведенные из номера, занятость,
 * проблемы оборудования.
 */

export type Layer = 'control' | 'variant' | 'pin' | 'problems' | 'occupancy';

export interface MockRoom {
  key: string;
  number: string;
  building: string;
  floor: string;
  /** Позиция на этаже — то, что совпадает у номеров «друг под другом» (стояк). */
  position: string;
  category: string;
  variant: string | null;
  pin: boolean;
  active: boolean;
  /** Этаж и позиция выведены из номера, а не заданы в отеле. */
  derived: boolean;
  /** Образец: связь оборудования номера. */
  control: 'ok' | 'silent' | 'none';
  /** Образец: занятость. */
  occupancy: 'free' | 'occupied' | 'cleaning' | 'out';
  /** Образец: что мешает номеру. */
  problems: string[];
}

export interface MockHotel {
  id: string;
  name: string;
  source: 'stand' | 'local';
  roomControl: boolean;
  rooms: MockRoom[];
}

/** Детерминированный «случай» — чтобы образец не прыгал от перерисовки. */
function seeded(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Этаж и позиция из номера, если отель их не задал: «2205» → этаж 2,
 * позиция 05 (Метрополь); «1302» → секция 1, этаж 3, позиция 02 (Сиалия).
 */
function derive(number: string, floor: string): { floor: string; position: string; derived: boolean } {
  const digits = number.replace(/\D/g, '');
  const position = digits.length >= 3 ? digits.slice(-2) : digits;
  if (floor) return { floor, position, derived: false };
  if (digits.length === 4) return { floor: digits[0], position, derived: true };
  if (digits.length === 3) return { floor: digits[0], position, derived: true };
  return { floor: '', position, derived: true };
}

function normalize(raw: { number: string; building: string; floor: string; category: string; variant: string | null; pin: boolean; active: boolean }, roomControl: boolean): MockRoom {
  const place = derive(raw.number, raw.floor);
  const r = seeded(raw.number + raw.building);
  const control: MockRoom['control'] = !roomControl ? 'none' : r < 0.06 ? 'silent' : 'ok';
  const occupancy: MockRoom['occupancy'] = r < 0.55 ? 'occupied' : r < 0.85 ? 'free' : r < 0.95 ? 'cleaning' : 'out';
  const problems: string[] = [];
  if (roomControl && !raw.variant) problems.push('noVariant');
  if (roomControl && !raw.pin) problems.push('noPin');
  if (control === 'silent') problems.push('silent');
  return {
    key: `${raw.building}|${raw.number}`,
    number: raw.number,
    building: raw.building,
    floor: place.floor,
    position: place.position,
    category: raw.category,
    variant: raw.variant,
    pin: raw.pin,
    active: raw.active,
    derived: place.derived,
    control,
    occupancy,
    problems,
  };
}

/** Снимок стенда: варианты номеров там ещё не назначены — для макета раскладываем образцом по категории. */
function standHotel(code: 'metropol' | 'sialia'): MockHotel {
  const hotel = (stand as { hotels: Record<string, { name: string; room_control: boolean; rooms: Array<{ number: string; building: string; floor: string; category: string; variant: string | null; pin: boolean; active: boolean }> }> }).hotels[code];
  const sampleVariant = (category: string) => (category ? `${category}` : null);
  const rooms = hotel.rooms.map((room) => {
    const r = seeded(room.number);
    const withSample = {
      ...room,
      // Образец: три четверти номеров уже привязаны к варианту по категории, у
      // части есть PIN — чтобы слои было видно. Настоящие данные стенда: ни
      // вариантов, ни PIN.
      variant: room.variant ?? (r < 0.75 ? sampleVariant(room.category) : null),
      pin: room.pin || r < 0.6,
    };
    return normalize(withSample, true);
  });
  return { id: code, name: code === 'metropol' ? 'Метрополь' : 'Сиалия', source: 'stand', roomControl: true, rooms };
}

export const STAND_HOTELS = { metropol: standHotel('metropol'), sialia: standHotel('sialia') };

/** Локальный отель — живыми номерами (ручка чтения номерного фонда). */
export function useLocalHotel(id: string | null) {
  return useQuery({
    queryKey: ['sandbox63', 'rooms', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<MockHotel> => {
      const page = await getHotelRooms(id!, {});
      return {
        id: id!,
        name: '',
        source: 'local',
        roomControl: page.room_control,
        rooms: page.items.map((room: RoomRow) =>
          normalize({ number: room.number, building: room.building, floor: room.floor, category: room.category, variant: room.variant?.title ?? null, pin: room.pin, active: room.is_active }, page.room_control),
        ),
      };
    },
  });
}

/** Локальные отели для выбора (живые). */
export function useLocalHotels() {
  return useQuery({
    queryKey: ['sandbox63', 'hotels'],
    queryFn: () => getHotelsView({ layout: 'list', origin: 'all' }),
  });
}

/** Номера одного корпуса, разложенные по этажам и позициям. */
export interface BuildingLayout {
  building: string;
  floors: string[];
  positions: string[];
  at: Map<string, MockRoom>;
}

const NAT = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

export function layout(rooms: MockRoom[]): BuildingLayout[] {
  const byBuilding = new Map<string, MockRoom[]>();
  for (const room of rooms) {
    const list = byBuilding.get(room.building) ?? [];
    list.push(room);
    byBuilding.set(room.building, list);
  }
  return [...byBuilding.entries()]
    .sort(([a], [b]) => NAT.compare(a, b))
    .map(([building, list]) => {
      const floors = [...new Set(list.map((r) => r.floor))].sort((a, b) => NAT.compare(b, a));
      const positions = [...new Set(list.map((r) => r.position))].sort((a, b) => NAT.compare(a, b));
      const at = new Map(list.map((r) => [`${r.floor}|${r.position}`, r]));
      return { building, floors, positions, at };
    });
}

export const naturalCompare = (a: string, b: string) => NAT.compare(a, b);
