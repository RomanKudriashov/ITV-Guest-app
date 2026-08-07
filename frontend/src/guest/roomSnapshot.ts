/**
 * ЧТЕНИЕ СНИМКА НОМЕРА — ОДНО НА ВСЕ ЭКРАНЫ.
 *
 * Снимок приезжает одним запросом и одним каналом (`useRoomState`), а читают
 * его двое: экран номера и строка состояния на главной. Разбор вынесен сюда
 * именно поэтому: два разбора одного снимка — это два ответа на вопрос «горит
 * ли свет», и однажды они разойдутся. Второго источника данных о номере в
 * продукте нет, и второго прочтения тоже быть не должно.
 */

import { useMemo, useRef } from 'react';

import type {
  RoomCapability,
  RoomControl,
  RoomStateSnapshot,
  RoomZone,
} from './api/types';

export interface Reading {
  control: RoomControl;
  /** ПОСЛЕДНИЕ ПОДТВЕРЖДЁННЫЕ значения. Пусто — состояние не читается. */
  values: Partial<Record<RoomCapability, number>>;
  busy: boolean;
  unreadable: boolean;
  readonly: boolean;
}

export type Readings = Record<string, Reading>;

export function readingOn(reading: Reading | undefined): boolean | null {
  if (!reading || reading.values.toggle === undefined) return null;
  return reading.values.toggle === 1;
}



/**
 * Чтение по каждому элементу с ПАМЯТЬЮ последнего подтверждённого значения.
 *
 * Ради этой памяти хук и существует. Сервер в полёте значений не отдаёт — он
 * их не перечитывал, — и без памяти список рисовал бы элемент ВЫКЛЮЧЕННЫМ на
 * время обмена: гость нажимал «включить», видел, как свет гаснет на экране, и
 * через секунду загорается. Это враньё, и оно жило на экране с G5a: плану
 * память завели, а списку — нет.
 *
 * Память стирается, как только элемент ушёл в `offline`: там состояния нет, и
 * «что было» — ровно то враньё, ради запрета которого написан весь экран.
 */
export function useRoomReadings(snapshot: RoomStateSnapshot | undefined): Readings {
  const memory = useRef<Record<string, Partial<Record<RoomCapability, number>>>>({});

  return useMemo(() => {
    const readings: Readings = {};
    for (const zone of snapshot?.zones ?? []) {
      for (const control of zone.controls) {
        const id = control.controlId;
        if (control.state === 'confirmed') {
          const values: Partial<Record<RoomCapability, number>> = {};
          for (const capability of control.capabilities) {
            const value = readValue(control, capability);
            if (value !== null) values[capability] = value;
          }
          memory.current[id] = values;
        } else if (control.state === 'offline') {
          delete memory.current[id];
        }
        readings[id] = {
          control,
          values: control.state === 'offline' ? {} : (memory.current[id] ?? {}),
          busy: control.state === 'pending',
          unreadable: control.state === 'offline',
          readonly: control.readonly,
        };
      }
    }
    return readings;
  }, [snapshot]);
}


/** Значение ручки: скаляр у простого элемента, поле объекта у составного. */
export function readValue(control: RoomControl, capability: RoomCapability): number | null {
  const key = capability === 'toggle' ? 'on' : capability;
  if (control.value === null || control.value === undefined) return null;
  if (typeof control.value === 'number') {
    return control.capabilities.length === 1 ? control.value : null;
  }
  const found = control.value[key];
  return typeof found === 'number' ? found : null;
}

/**
 * Раскладка элементов по панелям: свет, климат, шторы, сцены, сервис.
 *
 * Там, где вид элемента виден по CAPABILITY, решает она: уставка — климат,
 * триггер — сцена. Свет от шторы и от сервиса capability не отличает (у всех
 * один `toggle`), и там решает `kind` — код каталога, который ровно и говорит,
 * ЧЕМ элемент является. Это по-прежнему решение о показе, а не о поведении:
 * команда собирается из capability, и ни одна ветка отправки на kind не
 * смотрит.
 */
export type GroupKey = 'light' | 'climate' | 'curtain' | 'scene' | 'service';
export type Groups = Record<GroupKey, RoomControl[]>;

export function groupControls(zones: RoomZone[]): Groups {
  const groups: Groups = { light: [], climate: [], curtain: [], scene: [], service: [] };
  for (const zone of zones) {
    for (const control of zone.controls) {
      if (control.capabilities.includes('setpoint')) groups.climate.push(control);
      else if (control.capabilities.includes('trigger')) groups.scene.push(control);
      else if (control.kind.startsWith('light')) groups.light.push(control);
      else if (control.kind.startsWith('curtain')) groups.curtain.push(control);
      else groups.service.push(control);
    }
  }
  return groups;
}
