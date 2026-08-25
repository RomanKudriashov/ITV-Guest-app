import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { api, request } from '@/api/client';
import { platformRequest, platformUpload } from '@/admin/adminClient';
import * as grms from '@/api/grms';
import type { GrmsTransport } from '@/api/grms';
import type { ContentLanguages } from '@/hooks/useBootstrap';

/**
 * ОБЛАСТЬ УПРАВЛЕНИЯ НОМЕРОМ: чей это запрос и куда он идёт.
 *
 * Одни и те же экраны обслуживают две стороны, и это осознанно:
 *
 *   CMS отеля  — `/cms/grms`, доступ гостя и проверка связи;
 *   консоль    — `/platform/hotels/{id}/grms`, вся конфигурация.
 *
 * Вторая копия экранов означала бы вторую копию каждой ошибки в них, поэтому
 * различается ровно одно — путь.
 *
 * КОНТЕКСТ, А НЕ ГЛОБАЛЬНАЯ ПЕРЕМЕННАЯ. В консоли база зависит от ОТКРЫТОГО
 * отеля и меняется при переходе между ними; модульная переменная, выставленная
 * один раз при загрузке, отправила бы правки в соседний отель.
 */
export interface GrmsScope {
  transport: GrmsTransport;
  /**
   * ЯЗЫКИ КОНТЕНТА ПРИХОДЯТ СЮДА, А НЕ БЕРУТСЯ ИЗ CMS-КОНТЕКСТА.
   *
   * Экраны звали `useBootstrap()` — ручку CMS. В консоли её нет, запрос
   * отвечал 401, и оператора уводило на вход ОТЕЛЯ: экран конфигурации
   * платформы отправлял человека логиниться к клиенту.
   *
   * Список знают обе стороны, просто из разных мест: CMS — из бутстрапа,
   * консоль — из карточки отеля. Кто именно принёс, экрану знать незачем.
   */
  languages: ContentLanguages;
  /** Наша ли это сторона. По нему экраны решают, что показывать. */
  isPlatform: boolean;
  /** Отель, если мы в консоли. В CMS он один и подразумевается. */
  hotelId?: string;
}

/** CMS отеля: обычный клиент, его токен, его вход. */
const CMS_TRANSPORT: GrmsTransport = {
  base: '/cms/grms',
  get: (path) => api.get(path),
  post: (path, body) => api.post(path, body),
  put: (path, body) => api.put(path, body),
  upload: (path, form) => request(path, { method: 'POST', formData: form }),
};

/** Пока языки не приехали — русский: заголовок надо чем-то подписать. */
const FALLBACK_LANGUAGES: ContentLanguages = {
  codes: ['ru'],
  defaultCode: 'ru',
  labels: { ru: 'Русский' },
  displayLanguage: 'ru',
};

const ScopeContext = createContext<GrmsScope>({
  transport: CMS_TRANSPORT,
  isPlatform: false,
  languages: FALLBACK_LANGUAGES,
});

export function GrmsScopeProvider({
  hotelId,
  languages,
  children,
}: {
  /** Задан — консоль платформы; не задан — CMS отеля. */
  hotelId?: string;
  /** Языки контента ОТЕЛЯ. Хозяин экрана приносит их сам — см. `GrmsScope`. */
  languages?: ContentLanguages;
  children: ReactNode;
}) {
  const value = useMemo<GrmsScope>(
    () =>
      hotelId
        ? {
            // Консоль: платформенный токен, платформенный обмен, платформенный
            // вход. База адресует ОТКРЫТЫЙ отель — «текущего» здесь нет.
            transport: platformTransport(`/hotels/${encodeURIComponent(hotelId)}/grms`),
            isPlatform: true,
            hotelId,
            languages: languages ?? FALLBACK_LANGUAGES,
          }
        : {
            transport: CMS_TRANSPORT,
            isPlatform: false,
            languages: languages ?? FALLBACK_LANGUAGES,
          },
    [hotelId, languages],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

function platformTransport(base: string): GrmsTransport {
  return {
    base,
    get: (path) => platformRequest(path),
    post: (path, body) => platformRequest(path, 'POST', body),
    put: (path, body) => platformRequest(path, 'PUT', body),
    upload: (path, form) => platformUpload(path, form),
  };
}

export function useGrmsScope(): GrmsScope {
  return useContext(ScopeContext);
}

/**
 * Клиент, привязанный к области.
 *
 * Экран зовёт `grms.fetchTypes()` и не знает, куда именно уходит запрос, —
 * знает контекст. Ключи кэша обязаны включать базу: иначе консоль показала бы
 * типы одного отеля под именем другого.
 */
export function useGrms() {
  const { transport } = useGrmsScope();
  const base = transport.base;
  return useMemo(
    () => ({
      base,
      catalog: () => grms.fetchGrmsCatalog(transport),
      types: () => grms.fetchGrmsTypes(transport),
      status: (code: string) => grms.fetchTypeStatus(transport, code),
      previewImport: (file: File) => grms.previewImport(transport, file),
      reconcileImport: (preview: Parameters<typeof grms.reconcileImport>[1]) =>
        grms.reconcileImport(transport, preview),
      confirmImport: (
        preview: Parameters<typeof grms.confirmImport>[1],
        replace: boolean,
      ) => grms.confirmImport(transport, preview, replace),
      addZone: (code: string, payload: Parameters<typeof grms.addZone>[2]) =>
        grms.addZone(transport, code, payload),
      addElement: (code: string, payload: Parameters<typeof grms.addElement>[2]) =>
        grms.addElement(transport, code, payload),
      addBinding: (code: string, payload: Parameters<typeof grms.addBinding>[2]) =>
        grms.addBinding(transport, code, payload),
      setDeviceOverride: (
        code: string,
        payload: Parameters<typeof grms.setDeviceOverride>[2],
      ) => grms.setDeviceOverride(transport, code, payload),
      checkElement: (code: string, payload: Parameters<typeof grms.checkElement>[2]) =>
        grms.checkElement(transport, code, payload),
      publishType: (code: string) => grms.publishType(transport, code),
      rollbackType: (code: string, version: number) => grms.rollbackType(transport, code, version),
      versions: (code: string) => grms.fetchVersions(transport, code),
    }),
    [transport, base],
  );
}
