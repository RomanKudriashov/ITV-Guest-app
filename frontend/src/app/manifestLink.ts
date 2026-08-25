import { HOST_ROLE } from './hostRole';

/**
 * Ссылка на манифест PWA — только там, где есть что устанавливать.
 *
 * Манифест в сборке один, а адресов теперь три вида. На корне платформы стоит
 * ЛЕНДИНГ: браузер, увидев там манифест гостевого приложения, предложил бы
 * установить на домашний экран рекламную страницу под именем «ITV Guest». На
 * адресе отеля и в режиме одного хоста установка осмысленна — там приложение.
 *
 * Ссылка вешается кодом, а не стоит в `index.html`, потому что решение зависит
 * от адреса, а `index.html` один на все адреса.
 */
export function attachWebManifest(): void {
  if (HOST_ROLE === 'platform') return;
  if (document.querySelector('link[rel="manifest"]')) return;

  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/manifest.webmanifest';
  document.head.appendChild(link);
}
